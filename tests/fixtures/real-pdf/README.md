# Real-PDF fixture (private on purpose)

`veg-all.expected.json` is the correct result for the owner's real PDF, **Veg-All Chicken Pot Pie Recipe - Food.com.pdf** (a web page printed to PDF by iOS: two recipe cards side by side, an advertisement drawn over the lower left, fractions drawn as separate pieces, text of the second card overlapping itself).

The PDF is not committed: it is a third-party page and this repository is public. To run the real-PDF tests, put your copy in one of these places (both are git-ignored):

- `tests/private/veg-all.pdf`
- or set `TR_REAL_PDF=/path/to/the.pdf`

Then:

```bash
node --test tests/real-pdf.test.mjs          # stages 1-3: raw pieces, layout reader, parser, import path; compares words and sections
node tools/e2e-real-pdf.cjs [outdir]         # stage 4: the real Recipe Rescue screen in a phone-size browser (needs Playwright, poppler)
node tools/pdf-stages.mjs the.pdf outdir     # writes every stage's output (pieces.json, stages.json, report.txt) to read and compare
```

Without the PDF the real-PDF test is reported as **skipped**, never as passed.

Stage 1 uses poppler (`pdftotext -bbox`/`-raw`) as a stand-in for PDFKit, which exists only on Apple devices. What PDFKit and Vision return for this file must be read on a device (see the Original tab note "How this was read").
