const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

app.post('/resultScraper', async (req, res) => {
    const searchPhrases = req.body.Keywords;
    const user_input = req.body.Description;
    const hf_bearer_token = req.body.HFbearer;
    if (!Array.isArray(searchPhrases)) {
      return res.status(400).send('Invalid input. Expected an array of search phrases.');
    }
    
    allResults = [];  
    try {
      const promises = searchPhrases.map(phrase => scrapeData(phrase));
      await Promise.all(promises);
      const jsonFilePath = 'extractedDataMOM.json';
      fileCreate(jsonFilePath, allResults);
      await runPythonScript(jsonFilePath,user_input,hf_bearer_token);
      res.send('Scraping and cleaning completed successfully.');
    } catch (error) {
      console.error('Error in scraping process:', error);
      res.send('An error occurred during the scraping process.');
    }
  });
  
  app.post('/processResults', async (req, res) => {
    const inputText = req.body.text;
    const gemini_bearer = req.body.Gbearer;
    
    exec(`python script.py 2 "${inputText}" "${gemini_bearer}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('Exec error:', error);
            res.status(500).json({ error: 'Execution error' });
            return;
        }
        try {
            const result = JSON.parse(stdout);
            res.json({ Keywords: result });
        } catch (jsonError) {
            console.error('JSON parse error:', jsonError);
            res.status(500).json({ error: 'JSON parse error' });
        }
    });
});

app.get('/data', async (req, res) => {
  const jsonFilePath = path.join(__dirname, 'extractedDataMOM.json');
  fs.readFile(jsonFilePath, 'utf8', (err, data) => {
      if (err) {
          res.status(500).send('Error reading data');
          return;
      }
      res.json(JSON.parse(data));
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

let allResults = [];

async function extractDataFromPage(page) {
  try {
    await page.waitForSelector('.result-list');
    const results = await page.evaluate(() => {
      const extractDataArray = [];
      const resultElements = document.querySelectorAll('.result-list .result.even, .result-list .result.odd');
      resultElements.forEach(result => {
        const extractData = {};
        const titleElement = result.querySelector('.result-title span[data-bind="html: title"]');
        if (titleElement) {
          const clone = titleElement.cloneNode(true);
          clone.querySelectorAll('span.hlt').forEach(innerSpan => {
            innerSpan.replaceWith(innerSpan.textContent);
          });
          extractData.Title = clone.textContent.trim();
        } else {
          extractData.Title = "";
        }
        const linkElement = result.querySelector('.result-title');
        extractData.Link = linkElement ? linkElement.getAttribute('href') : "";
        const sourceNameElement = result.querySelector('[data-bind="html: sourceName"]');
        extractData.SourceName = sourceNameElement ? sourceNameElement.textContent.trim() : "";
        const authorElement = result.querySelector('[id^="authors-result_"]');
        extractData.Author = authorElement ? authorElement.textContent.trim() : "";
        const dateElement = result.querySelector('[data-bind="foreach: dates"] [data-bind="html: value"]');
        extractData.Date = dateElement ? dateElement.textContent.trim() : "";
        let keywordsElement = "";
        const divElements = result.querySelectorAll('div');
        divElements.forEach(div => {
          if (div.textContent.includes('Keywords:')) {
            keywordsElement = div.querySelector('span[data-bind*="keywords.join"]');
          }
        });
        extractData.Keywords = keywordsElement ? keywordsElement.textContent.split(',').map(keyword => keyword.trim()) : "";
        const descriptionElement = result.querySelector('.result-snippet');
        extractData.Description = descriptionElement ? descriptionElement.textContent.trim() : "";
        extractDataArray.push(extractData);
      });
      return extractDataArray;
    });

    console.log('Extracted results!');
    return results;
  } catch (error) {
    console.error('Error extracting data from page:', error);
    return [];
  }
}

async function scrapeData(phrase, maxRetries = 3) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const browser = await puppeteer.launch({ 
        headless: true,
        defaultViewport: false,
      });

      const page = await browser.newPage();
      await page.goto('https://oer.deepwebaccess.com/oer/desktop/en/search.html', { waitUntil: 'networkidle2' });

      page.setDefaultTimeout(60000);
      await page.waitForSelector('#FULLRECORD');
      console.log(`Page loaded for phrase: ${phrase}`);
      await page.type('#FULLRECORD', phrase);
      await page.keyboard.press('Enter');
      await page.waitForSelector('#add-results-modal', { visible: true });
      await page.waitForSelector('#add-results-modal .btn.btn-primary');
      await page.click('#add-results-modal .btn.btn-primary');
      console.log(`Got additional results for phrase: ${phrase}`);
      
      let phraseResults = [];
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        console.log(`Extracting data from page ${pageNum} for phrase: ${phrase}...`);
        const pageResults = await extractDataFromPage(page);
        phraseResults = phraseResults.concat(pageResults);
        if (pageNum < 3) {
          try {
            const expectedStartNum = pageNum * 20 + 1;
            await page.waitForSelector('li:not(.disabled) a[data-bind="click: function(){ CurrentPage(CurrentPage() + 1); }"]', { visible: true });
            await page.evaluate(() => {
              const nextButton = document.querySelector('li:not(.disabled) a[data-bind="click: function(){ CurrentPage(CurrentPage() + 1); }"]');
              if (nextButton) nextButton.click();
            });
            await page.waitForFunction(
              (expectedStartNum) => {
                const startNumElement = document.querySelector('#current-results span[data-bind="count: startNum"]');
                return startNumElement && parseInt(startNumElement.textContent, 10) === expectedStartNum;
              },
              { timeout: 5000 },
              expectedStartNum
            );
          } catch (error) {
            console.error(`Error navigating to page ${pageNum + 1} for phrase: ${phrase}`, error);
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

function runPythonScript(inputText,user_input,hf_bearer_token) {
  return new Promise((resolve, reject) => {
    const command = `python script.py 1 "${inputText}" "${user_input}" "${hf_bearer_token}"`;
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
}
