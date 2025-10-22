const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function chunkArray(array, chunkSize) {
  const result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}

const baseUrl = "https://nilaigizi.com/pencarian/pencarian_adv";
(async () => {
  const initialPage = 1;
  const url = `${baseUrl}/${initialPage}`;
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // get total pages
  const totalPages = await page.$$eval(".text-muted", (nodes) => {
    const info = nodes.find((n) => n.textContent.includes("Halaman"));
    if (!info) return null;
    const match = info.textContent.match(/Halaman\s+\d+\s+dari\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  });

  for (let i = initialPage; i <= totalPages; i++) {
    if (i > initialPage) {
      const url = `${baseUrl}/${i}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    await page.waitForSelector(".row .col-sm-12");
    const count = await page.$$eval(".row .col-sm-12 .row .col-md-11", (e) => e.length);
    const foods = [];
    const result = [];

    // get all foods
    for (let j = 0; j < count; j++) {
      const cols = await page.$$(".row .col-sm-12 .row .col-md-11");
      const col = cols[j];

      if (!col) continue;
      const food = await col.evaluate((e) => {
        const link = e.querySelector("a").href;
        const title = e.querySelector(".row.text-success").textContent.trim();

        return { link, title };
      });

      foods.push(food);
    }

    // go to detail food to extract nutrition
    for (let j = 0; j < foods.length; j++) {
      const food = foods[j];
      const url = food.link;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".card-body");

      const nutrition = await page.evaluate(() => {
        const section = [...document.querySelectorAll("div.col-sm-12")].find((div) =>
          div.querySelector("h5.title b")?.textContent.includes("Informasi Nilai Gizi")
        );
        if (!section) return null;

        const rows = [...section.querySelectorAll("tbody.f11 tr")];
        const data = {
          servingsPerPack: null,
          servingSize: null,
          items: [],
        };

        rows.forEach((tr) => {
          const textCells = [...tr.querySelectorAll("td")]
            .map((td) => td.innerText.replace(/\s+/g, " ").trim())
            .filter(Boolean);
          if (!textCells.length) return;

          const [label, value = "", percent = ""] = textCells;

          if (/Jumlah Sajian Per Kemasan/i.test(label)) {
            data.servingsPerPack = value || percent;
          } else if (/Jumlah Per Sajian/i.test(label)) {
            data.servingSize = value.replace(/[()]/g, "");
          } else if (!/^% AKG/i.test(label)) {
            data.items.push({
              name: label,
              amount: value,
              percent: percent === "-" ? null : percent,
            });
          }
        });

        return data;
      });

      result.push({
        ...food,
        ...nutrition,
      });
    }

    const outputDir = path.join(__dirname, "food_nutrition_chunks");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const filename = path.join(outputDir, `food_nutrition_${i}.json`);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), "utf-8");
    console.log(`Saved: ${filename}`);
  }

  await browser.close();
})();
