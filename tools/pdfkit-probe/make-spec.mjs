// Page spec for the PDFKit probe: an INVENTED two-card recipe page with the geometry of a printed web page (directions | amounts | ingredients
// in touching columns, amounts centred beside multi-line ingredients, fractions drawn as three pieces, a second recipe card at the right).
// Each entry is one drawn string: { text, x, top, size, bold }. Written to the file given as the first argument.
import fs from 'node:fs';
const B = 11.5, CW = B * 0.5;                    // body size; approximate advance per character (only used to right-align amounts)
const spec = [];
const put = (text, x, top, size = B, bold = false) => spec.push({ text, x, top, size, bold });
const amount = (t, edge, top) => {
  const m = /^(\d)\/(\d)$/.exec(t);
  if (!m) { put(t, edge - CW * t.length, top); return; }
  put(m[1], edge - 10, top - 1, 8); put('⁄', edge - 7, top + 1, 11); put(m[2], edge - 5, top + 5, 8);   // numerator, fraction slash, denominator
};
const table = (x, edge, top, blocks, pitch = 17.6) => { let y = top; const tops = []; for (const [amt, lines] of blocks) { lines.forEach((t, i) => put(t, x, y + i * pitch)); const bottom = y + (lines.length - 1) * pitch + B; amount(amt, edge, (y + bottom) / 2 - B / 2); tops.push(y); y = bottom + 9; } return tops; };

// card 1
['SAVORY', 'CHICKEN', 'PIE'].forEach((t, i) => put(t, 29.5, 87 + i * 24.4, 23, true));
put('Submitted by Ann Cook', 29.5, 172);
['"It is really easy to make. I use deep dish pie', 'crust. I found this recipe from a co-worker', 'cookbook. It calls for a can of mixed vegetables,', 'I use a bag of frozen."'].forEach((t, i) => put(t, 29.5, 197.4 + i * 17.2));
put('Ready In: 1hr 10mins', 49.5, 283.4); put('Serves: 4-6', 198, 283.4); put('Ingredients: 8', 49.5, 312.1);
put('DIRECTIONS', 29.5, 355.3, 14.3, true); put('INGREDIENTS', 172.2, 355.3, 14.3, true);
const tops = table(200, 182.4, 387.5, [['2', ['(10 3/4 ounce) cans', 'cream of mushroom', 'soup']], ['1', ['(16 ounce) can mixed', 'vegetables, drained']], ['2', ['cups cooked', 'chicken, diced']], ['1/2', ['cup milk']], ['1/2', ['teaspoon thyme']], ['1/2', ['teaspoon black', 'pepper']], ['2', ['(9 inch) frozen pie', 'crusts, thawed']], ['1', ['egg, lightly beaten']]]);
[['1.', 'Combine first 6', 'ingredients.'], ['2.', 'Spoon into prepared', 'pie crust.'], ['3.', 'Cover with top crust;', 'crimp edges to seal.'], ['4.', 'Slit the top and brush', 'with egg.'], ['5.', 'Bake at 375 degrees', 'for 40 minutes.'], ['6.', 'Cool 10 minutes', 'before serving.']]
  .forEach(([n, a, b], i) => { const top = i === 4 ? tops[4] : 387.5 + i * 40.2; put(n, 29.2, top); put(a, 52.4, top); put(b, 52.4, top + 17.2); });
// card 2 (a complete second recipe, in a sidebar)
['GINGER', 'COOKIES'].forEach((t, i) => put(t, 337.7, 111 + i * 24.4, 23, true));
put('Submitted by Ben Baker', 337.7, 172);
['"Crisp at the edges and soft in the middle.', 'Everyone asks for the recipe."'].forEach((t, i) => put(t, 337.7, 197.4 + i * 17.2));
put('Ready In: 35mins', 337.7, 283.4); put('Serves: 4', 470, 283.4); put('Ingredients: 3', 337.7, 312.1);
put('DIRECTIONS', 337.7, 355.3, 14.3, true); put('INGREDIENTS', 470, 355.3, 14.3, true);
['1. Mix the dough.', '2. Roll into balls.', '3. Bake until golden.'].forEach((t, i) => put(t, 337.7, 387.5 + i * 25));
table(500, 490, 387.5, [['2', ['cups flour']], ['1', ['egg']], ['1/2', ['cup sugar']]]);
fs.writeFileSync(process.argv[2], JSON.stringify(spec));
console.log(`spec: ${spec.length} strings`);
