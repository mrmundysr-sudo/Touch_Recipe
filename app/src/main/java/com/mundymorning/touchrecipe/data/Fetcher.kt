package com.mundymorning.touchrecipe.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

sealed interface FetchOutcome {
    data class Page(val body: String, val finalUrl: String) : FetchOutcome
    data class Blocked(val status: Int, val message: String) : FetchOutcome
    data class Failure(val message: String, val offline: Boolean = false) : FetchOutcome
}

interface PageFetcher {
    suspend fun fetchPage(url: String): FetchOutcome
    suspend fun fetchBytes(url: String, maxBytes: Int = 8 * 1024 * 1024): ByteArray?
}

/** Plain user-directed HTTP GET. Does not log in, solve challenges or evade blocks: a blocked page is reported as blocked. */
class HttpPageFetcher : PageFetcher {
    private val ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 TouchRecipe/1.0"

    private fun open(url: String, accept: String): HttpURLConnection {
        var current = url
        repeat(6) {
            val u = URL(current)
            require(u.protocol == "https" || u.protocol == "http") { "Only web links can be imported." }
            val c = (if (u.protocol == "http") URL(current.replaceFirst("http://", "https://")) else u).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 12_000; c.readTimeout = 15_000
            c.setRequestProperty("User-Agent", ua)
            c.setRequestProperty("Accept", accept)
            c.setRequestProperty("Accept-Language", java.util.Locale.getDefault().toLanguageTag() + ",en;q=0.8")
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location") ?: return c
                current = URL(c.url, loc).toString(); c.disconnect()
            } else return c
        }
        throw java.io.IOException("Too many redirects")
    }

    override suspend fun fetchPage(url: String): FetchOutcome = withContext(Dispatchers.IO) {
        try {
            val c = open(url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
            val code = c.responseCode
            val final = c.url.toString()
            if (code == 401 || code == 403 || code == 429 || code == 451 || code == 503) {
                return@withContext FetchOutcome.Blocked(code, "The site declined to share this page automatically (HTTP $code).")
            }
            if (code !in 200..299) return@withContext FetchOutcome.Failure("The page answered with an error (HTTP $code).")
            val type = c.contentType.orEmpty().lowercase()
            if (type.isNotEmpty() && !type.contains("html") && !type.contains("xml") && !type.contains("text")) return@withContext FetchOutcome.Failure("That link is not a web page.")
            val charset = Regex("""charset=([\w-]+)""").find(type)?.groupValues?.get(1) ?: "UTF-8"
            val out = ByteArrayOutputStream()
            c.inputStream.use { ins ->
                val buf = ByteArray(16 * 1024); var total = 0
                while (true) { val n = ins.read(buf); if (n < 0) break; total += n; if (total > 6 * 1024 * 1024) break; out.write(buf, 0, n) }
            }
            FetchOutcome.Page(out.toString(runCatching { charset(charset) }.getOrDefault(Charsets.UTF_8)), final)
        } catch (e: java.net.UnknownHostException) { FetchOutcome.Failure("No internet connection, or the address could not be found.", offline = true)
        } catch (e: java.net.SocketTimeoutException) { FetchOutcome.Failure("The site took too long to answer.", offline = true)
        } catch (e: javax.net.ssl.SSLException) { FetchOutcome.Failure("A secure connection to the site could not be made.")
        } catch (e: java.io.IOException) { FetchOutcome.Failure("The page could not be loaded: ${e.message ?: "network error"}.", offline = true)
        } catch (e: IllegalArgumentException) { FetchOutcome.Failure(e.message ?: "That doesn't look like a web link.")
        } catch (e: Exception) { FetchOutcome.Failure("The page could not be loaded.") }
    }

    override suspend fun fetchBytes(url: String, maxBytes: Int): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val c = open(url, "image/*")
            if (c.responseCode !in 200..299) return@withContext null
            val out = ByteArrayOutputStream()
            c.inputStream.use { ins ->
                val buf = ByteArray(16 * 1024); var total = 0
                while (true) { val n = ins.read(buf); if (n < 0) break; total += n; if (total > maxBytes) return@withContext null; out.write(buf, 0, n) }
            }
            out.toByteArray()
        } catch (e: Exception) { null }
    }
}
