const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const baseUrl = "https://www.fatsecret.co.id/kalori-gizi/search?q=a";
const outputDir = path.join(__dirname, "food_nutrition_chunks");

async function gotoWithRetry(page, url, maxRetry = 3) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".nutrition_facts.international");

      return;
    } catch (err) {
      if (err.message.includes("429") && attempt < maxRetry) {
        const delay = 5000 * attempt;
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

function resolveStartPage() {
  if (!fs.existsSync(outputDir)) return 0;

  const files = fs
    .readdirSync(outputDir)
    .map((name) => {
      const match = name.match(/^food_nutrition_(\d+)\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((n) => Number.isInteger(n));

  if (files.length === 0) return 0;
  return Math.max(...files) + 1; // lanjutkan setelah file terakhir
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const initialPage = 0;
  let currentPage = resolveStartPage();
  const url = `${baseUrl}&pg=${initialPage}`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  while (true) {
    const start = Date.now();
    let processedPages = 0;

    if (currentPage > initialPage) {
      const url = `${baseUrl}&pg=${currentPage}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    await page.waitForSelector(".generic.searchResult");
    const count = await page.$$eval(".generic.searchResult tr", (e) => e.length);
    const foods = [];
    const result = [];

    if (count === 0) {
      console.log(`Selesai dipage ${currentPage}`);
      break;
    }

    // get all food
    for (let i = 0; i < count; i++) {
      const rows = await page.$$(".generic.searchResult tr");
      const row = rows[i];

      const food = await row.evaluate((e) => {
        const nameAnchor = e.querySelector("a.prominent");
        const brandAnchor = e.querySelector("a.brand");

        return {
          name: nameAnchor?.textContent.trim() || null,
          brand: brandAnchor?.textContent.replace(/[()]/g, "").trim() || null,
          link: nameAnchor.href,
        };
      });

      foods.push(food);
    }

    // go to detail food to extract nutrition
    for (let i = 0; i < foods.length; i++) {
      const food = foods[i];
      const url = food.link;

      await sleep(1000);
      await gotoWithRetry(page, url);

      const nutrition = await page.$eval(".nutrition_facts.international", (root) => {
        const servingSize =
          root.querySelector(".serving_size.serving_size_value")?.textContent.trim() || null;

        const nutrients = [];
        let currentParent = null;

        Array.from(
          root.querySelectorAll(".nutrient.left, .nutrient.black.left, .nutrient.sub.left")
        ).forEach((leftEl) => {
          const label = leftEl.textContent.trim();
          const valueEl = leftEl.nextElementSibling;
          const value =
            valueEl && valueEl.classList.contains("right") ? valueEl.textContent.trim() : null;
          if (!label || !value) return;

          const isSub = leftEl.classList.contains("sub");
          if (!isSub) {
            if (label.toLowerCase() === "energi" && value.toLowerCase().includes("kj")) return;
            currentParent = { label, value, children: [] };
            nutrients.push(currentParent);
          } else if (currentParent) {
            currentParent.children.push({ label, value });
          }
        });

        const normalized = nutrients.map((item) =>
          item.children.length ? item : { label: item.label, value: item.value }
        );

        return { servingSize, nutrients: normalized };
      });

      result.push({
        ...food,
        ...nutrition,
      });
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const filename = path.join(outputDir, `food_nutrition_${currentPage}.json`);
    fs.writeFileSync(filename, JSON.stringify(result, null, 2), "utf-8");
    console.log(`Saved: ${filename}`);

    // setelah setiap halaman selesai
    processedPages += 1;
    const elapsedMs = Date.now() - start;
    const avgMsPerPage = elapsedMs / processedPages;

    // misal saat ini currentPage = 120
    const targetPage = 999;
    const pagesLeft = Math.max(targetPage - currentPage, 0);
    const remainingMs = pagesLeft * avgMsPerPage;
    const remainingMinutes = remainingMs / 60000;

    console.log(`Estimasi selesai ~${remainingMinutes.toFixed(1)} menit lagi.`);

    // next page
    currentPage++;
  }

  await browser.close();
})();
