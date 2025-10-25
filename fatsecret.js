const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const environment = process.env.NODE_ENV;
const isProduction = environment === "production";

const outputDir = path.join(__dirname, "food_nutrition_chunks");

const gotoWithRetry = async (page, url, callback) => {
  const maxRetry = 3;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (callback) await callback();

      return;
    } catch (err) {
      if (attempt < maxRetry) {
        const delay = 5000 * attempt;
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
};

const resolveStartPage = (letter) => {
  const savedDir = path.join(outputDir, letter);
  if (!fs.existsSync(savedDir)) return 0;

  const files = fs
    .readdirSync(savedDir)
    .map((name) => {
      const match = name.match(/^food_nutrition_(\d+)\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((n) => Number.isInteger(n));

  if (files.length === 0) return 0;
  return Math.max(...files) + 1; // lanjutkan setelah file terakhir
};

const resolveStartLetter = (letters) => {
  let lastWithData = -1;

  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const savedDir = path.join(outputDir, letter);
    const hasDir = fs.existsSync(savedDir);

    if (!hasDir) {
      return lastWithData >= 0 ? lastWithData : i;
    }

    const hasFiles = fs
      .readdirSync(savedDir)
      .some((name) => /^food_nutrition_(\d+)\.json$/.test(name));

    if (!hasFiles) {
      return i;
    }

    lastWithData = i;
  }

  return lastWithData === letters.length - 1 ? letters.length : lastWithData;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const execute = async (letter) => {
  const baseUrl = `https://www.fatsecret.co.id/kalori-gizi/search?q=${letter}`;

  const initialPage = 0;
  let currentPage = resolveStartPage(letter);
  const url = `${baseUrl}&pg=${initialPage}`;
  const browser = await puppeteer.launch({
    headless: isProduction,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(isProduction && { executablePath: process.env.CHROMIUM_PATH }),
  });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  while (true) {
    const start = Date.now();
    let processedPages = 0;

    if (currentPage > initialPage) {
      const url = `${baseUrl}&pg=${currentPage}`;
      await gotoWithRetry(page, url);
    }

    const count = await page.$$eval(".generic.searchResult tr", (e) => e.length);
    const foods = [];
    const result = [];

    if (count === 0) {
      console.log(`Selesai page: ${currentPage}, letter: ${letter}`);
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
      await gotoWithRetry(page, url, async () => {
        await page.waitForSelector(".nutrition_facts.international");
      });

      const nutrition = await page.$eval(".nutrition_facts.international", (root) => {
        const servingSize =
          root.querySelector(".serving_size.serving_size_value")?.textContent.trim() || null;

        const nutrients = [];
        let currentParent = null;
        let lastMajorLabel = null;

        Array.from(
          root.querySelectorAll(".nutrient.left, .nutrient.black.left, .nutrient.sub.left")
        ).forEach((leftEl) => {
          const rawLabel = leftEl.textContent.trim();
          const label = rawLabel || lastMajorLabel;
          const valueEl = leftEl.nextElementSibling;
          const value =
            valueEl && valueEl.classList.contains("right") ? valueEl.textContent.trim() : null;
          if (!label || !value) return;

          const isSub = leftEl.classList.contains("sub");
          if (!isSub) {
            lastMajorLabel = label;
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

    const savedDir = path.join(outputDir, letter);
    if (!fs.existsSync(savedDir)) {
      fs.mkdirSync(savedDir, { recursive: true });
    }

    const filename = path.join(savedDir, `food_nutrition_${currentPage}.json`);
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
};

(async () => {
  const letter = "aiueo";
  const letters = letter.split("");
  const startIndex = resolveStartLetter(letters);

  for (let i = startIndex; i < letters.length; i++) {
    const element = letters[i];

    await execute(element);
  }
})();
