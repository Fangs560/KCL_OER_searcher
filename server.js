const puppeteer = require("puppeteer");
const axios = require("axios");
const { exec } = require("child_process");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");
const process = require("process");
const app = express();
const { GoogleGenerativeAI } = require("@google/generative-ai");
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname)));

// Serving the HTML code when the server begins
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
// Running the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Verifying HuggingFace bearer token
app.post("/verifyHuggingFace", async (req, res) => {
  const hg_token = req.body.hf_bearer_token;
  axios
    .get("https://huggingface.co/api/whoami-v2", {
      headers: {
        Authorization: `Bearer ${hg_token}`,
      },
    })
    .then((response) => {
      console.log("Valid HuggingFace token");
      res.status(200).json({ status: "Valid bearer token" });
    })
    .catch((error) => {
      console.log("Invalid HuggingFace token");
      res.status(200).json({ status: "Invalid bearer token" });
    });
});

// Verifying Google Gemini bearer token
app.post("/verifyGoogle", async (req, res) => {
  const google_token = req.body.Gbearer;
  const genAI = new GoogleGenerativeAI(google_token);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  try {
    const prompt = `Hi`;
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    console.log("Valid Google token");
    res.status(200).json({ status: "Valid bearer token" });
  } catch (error) {
    console.log("Invalid Google token");
    res.status(200).json({ status: "Invalid bearer token" });
  }
});

// Managing web scraping request
app.post("/resultScraper", async (req, res) => {
  const searchPhrases = req.body.Keywords;
  const user_input = req.body.Description;
  const hf_bearer_token = req.body.HFbearer;
  allResults = [];
  try {
    // Web scraping task is mapped
    const promises = searchPhrases.map((phrase) => scrapeData(phrase));
    await Promise.all(promises);

    // JSON file is created
    const jsonFilePath = "extractedDataMOM.json";
    fileCreate(jsonFilePath, allResults);

    // Request for running the python script
    await new Promise((resolve, reject) => {
      const command = `python similarity.py "${jsonFilePath}" "${user_input}" "${hf_bearer_token}"`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing Python script: ${stderr}`);
          reject(error);
        } else {
          console.log(`Python script output: ${stdout}`);
          resolve(stdout);
        }
      });
    });
    res.send("Scraping and cleaning completed successfully.");
  } catch (error) {
    console.error("Error in scraping process:", error);
    res.send("An error occurred during the scraping process.");
  }
});

// Generating key phrases through google Gemini
app.post("/processResults", async (req, res) => {
  const inputText = req.body.text;
  const gemini_bearer = req.body.Gbearer;

  try {
    const genAI = new GoogleGenerativeAI(gemini_bearer);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `Summarize the following text and extract the relevant key phrases and return only a JSON object with one attribute 'Keywords' and in which the keywords attribute consists of the generated key phrases which can be used in searching educational resources: ${inputText}`;
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    try {
      const jsonString = text.trim().replace(/^```json\n|\n```$/g, "");
      const parsedResult = JSON.parse(jsonString);
      const keywords = parsedResult.Keywords;
      res.json({ Keywords: keywords });
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      res
        .status(500)
        .json({ error: "An error occurred while processing the request" });
    }
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing the request" });
  }
});

// Fetching data from JSON file
app.get("/data", async (req, res) => {
  const jsonFilePath = path.join(__dirname, "extractedDataMOM.json");
  fs.readFile(jsonFilePath, "utf8", (err, data) => {
    if (err) {
      res.status(500).send("Error reading data");
      return;
    }
    res.json(JSON.parse(data));
  });
});

// Variable to store all webscraping results
let allResults = [];

// Loading the web page and parsing values into the page
async function scrapeData(phrase) {
  let maxRetries = 3;
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: false,
      });

      const page = await browser.newPage();
      await page.goto(
        "https://oer.deepwebaccess.com/oer/desktop/en/search.html",
        { waitUntil: "networkidle2" }
      );

      page.setDefaultTimeout(60000);
      await page.waitForSelector("#FULLRECORD");
      console.log(`Page loaded for phrase: ${phrase}`);
      await page.type("#FULLRECORD", phrase);
      await page.keyboard.press("Enter");
      await page.waitForSelector("#add-results-modal", { visible: true });
      await page.waitForSelector("#add-results-modal .btn.btn-primary");
      await page.click("#add-results-modal .btn.btn-primary");
      console.log(`Got additional results for phrase: ${phrase}`);

      let phraseResults = [];
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        console.log(
          `Extracting data from page ${pageNum} for phrase: ${phrase}...`
        );
        const pageResults = await extractDataFromPage(page);
        phraseResults = phraseResults.concat(pageResults);
        if (pageNum < 3) {
          try {
            const expectedStartNum = pageNum * 20 + 1;
            await page.waitForSelector(
              'li:not(.disabled) a[data-bind="click: function(){ CurrentPage(CurrentPage() + 1); }"]',
              { visible: true }
            );
            await page.evaluate(() => {
              const nextButton = document.querySelector(
                'li:not(.disabled) a[data-bind="click: function(){ CurrentPage(CurrentPage() + 1); }"]'
              );
              if (nextButton) nextButton.click();
            });
            await page.waitForFunction(
              (expectedStartNum) => {
                const startNumElement = document.querySelector(
                  '#current-results span[data-bind="count: startNum"]'
                );
                return (
                  startNumElement &&
                  parseInt(startNumElement.textContent, 10) === expectedStartNum
                );
              },
              { timeout: 5000 },
              expectedStartNum
            );
          } catch (error) {
            console.error(
              `Error navigating to page ${pageNum + 1} for phrase: ${phrase}`,
              error
            );
            break;
          }
        }
      }

      allResults = allResults.concat(phraseResults);
      await browser.close();

      break;
    } catch (error) {
      attempts++;
      console.error(`Attempt ${attempts} failed for phrase: ${phrase}`, error);
      if (attempts >= maxRetries) {
        console.error(`Max retries reached for phrase: ${phrase}.`);
        throw error;
      }
    }
  }
}


// Web scraping function to extract all values from each page and save all values
async function extractDataFromPage(page) {
  try {
    await page.waitForSelector(".result-list");
    const results = await page.evaluate(() => {
      const extractDataArray = [];
      const resultElements = document.querySelectorAll(
        ".result-list .result.even, .result-list .result.odd"
      );
      resultElements.forEach((result) => {
        const extractData = {};
        const titleElement = result.querySelector(
          '.result-title span[data-bind="html: title"]'
        );
        if (titleElement) {
          const clone = titleElement.cloneNode(true);
          clone.querySelectorAll("span.hlt").forEach((innerSpan) => {
            innerSpan.replaceWith(innerSpan.textContent);
          });
          extractData.Title = clone.textContent.trim();
        } else {
          extractData.Title = "";
        }
        const linkElement = result.querySelector(".result-title");
        extractData.Link = linkElement ? linkElement.getAttribute("href") : "";
        const sourceNameElement = result.querySelector(
          '[data-bind="html: sourceName"]'
        );
        extractData.SourceName = sourceNameElement
          ? sourceNameElement.textContent.trim()
          : "";
        const authorElement = result.querySelector('[id^="authors-result_"]');
        extractData.Author = authorElement
          ? authorElement.textContent.trim()
          : "";
        const dateElement = result.querySelector(
          '[data-bind="foreach: dates"] [data-bind="html: value"]'
        );
        extractData.Date = dateElement ? dateElement.textContent.trim() : "";
        let keywordsElement = "";
        const divElements = result.querySelectorAll("div");
        divElements.forEach((div) => {
          if (div.textContent.includes("Keywords:")) {
            keywordsElement = div.querySelector(
              'span[data-bind*="keywords.join"]'
            );
          }
        });
        extractData.Keywords = keywordsElement
          ? keywordsElement.textContent
              .split(",")
              .map((keyword) => keyword.trim())
          : "";
        const descriptionElement = result.querySelector(".result-snippet");
        extractData.Description = descriptionElement
          ? descriptionElement.textContent.trim()
          : "";
        extractDataArray.push(extractData);
      });
      return extractDataArray;
    });

    console.log("Extracted results!");
    return results;
  } catch (error) {
    console.error("Error extracting data from page:", error);
    return [];
  }
}

// Creating JSON file
function fileCreate(file_path, data) {
  fs.access(file_path, fs.constants.F_OK, (err) => {
    if (err) {
      console.log(`File ${file_path} created`);
      fs.writeFileSync(file_path, JSON.stringify(data, null, 2));
    } else {
      fs.unlink(file_path, (err) => {
        if (err) {
          console.error(`Error deleting the file: ${err}`);
        } else {
          console.log(`${file_path} deleted and re-created`);
          fs.writeFileSync(file_path, JSON.stringify(data, null, 2));
        }
      });
    }
  });
}
