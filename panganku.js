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

(async () => {
  const url = "https://www.panganku.org/en-EN/semua_nutrisi";
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });

  let allData = [];
  let pageNumber = 1;

  while (true) {
    await page.waitForSelector("table#data tbody tr");

    // Dapatkan jumlah baris pada halaman saat ini
    const trCount = await page.$$eval("table#data tbody tr", (trs) => trs.length);

    for (let i = 0; i < trCount; i++) {
      let food = {};

      // Pilih ulang semua tr setiap kali (DOM berubah setelah kembali dari detail)
      const trs = await page.$$("table#data tbody tr");
      const tr = trs[i];

      // food
      food = await tr.evaluate((row) => {
        const cells = row.querySelectorAll("td");
        return {
          nomor: cells[0]?.innerText.trim(),
          kode_pangan: cells[1]?.innerText.trim(),
          nama_pangan: cells[2]?.innerText.trim(),
          kelompok: cells[3]?.innerText.trim(),
          tipe: cells[4]?.innerText.trim(),
        };
      });

      // Scroll ke tr supaya pasti terlihat
      await tr.hover();
      await tr.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded" });

      // Tunggu halaman detail
      await page.waitForSelector(".about-company", { timeout: 10000 });

      // Ambil data nutrisi (contoh: semua tabel dalam .about-company)
      const nutrisi = await page.evaluate(() => {
        const result = {};
        document.querySelectorAll(".about-company table tbody tr").forEach((tr) => {
          const tds = tr.querySelectorAll("td");
          if (tds.length === 2) {
            const label = tds[0].innerText.split("(")[0].trim();
            const value = tds[1].innerText.replace(":", "").trim();
            result[label] = value;
          }
        });
        // Bisa ditambah ambil nama/kode pangan dari halaman detail jika tersedia
        return result;
      });

      food.nutrisi = nutrisi;

      // Kembali ke halaman utama
      await page.goBack({ waitUntil: "domcontentloaded" });

      // Tunggu tabel siap sebelum klik berikutnya
      await page.waitForSelector("table#data tbody tr");

      allData.push(food);
    }

    // Cek apakah tombol Next aktif/disabled
    const isNextDisabled = await page.$eval("#data_paginate a#data_next", (el) =>
      el.classList.contains("disabled")
    );
    if (isNextDisabled) break;

    // Klik Next, tunggu halaman update
    await Promise.all([
      page.click("#data_paginate a#data_next"),
      page.waitForFunction(
        (prev) => {
          const curr = document.querySelector("#data_paginate span a.paginate_button.current");
          return curr && parseInt(curr.textContent) > prev;
        },
        {},
        pageNumber
      ),
    ]);
    pageNumber++;
  }

  // Chunk and save allData per 100 items
  const chunks = chunkArray(allData, 100);

  const outputDir = path.join(__dirname, "food_nutrition_chunks");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  chunks.forEach((chunk, idx) => {
    const filename = path.join(outputDir, `food_nutrition_${idx + 1}.json`);
    fs.writeFileSync(filename, JSON.stringify(chunk, null, 2), "utf-8");
    console.log(`Saved: ${filename}`);
  });

  await browser.close();
})();
