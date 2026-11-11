# kotlinx.serialization keeps generated serializers via its own consumer rules.
-keepattributes *Annotation*, InnerClasses
-dontwarn org.jspecify.annotations.**
-dontwarn com.google.re2j.**

# PdfBox-Android (PDF text layer). Optional image codecs it can use are not shipped.
-keep class com.tom_roush.pdfbox.** { *; }
-keep class com.tom_roush.fontbox.** { *; }
-dontwarn com.gemalto.jp2.**
-dontwarn org.bouncycastle.**
-dontwarn javax.naming.**
