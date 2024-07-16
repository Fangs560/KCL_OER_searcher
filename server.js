// const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require("path");
const https = require('https');
const process = require('process');
const app = express();
const { GoogleGenerativeAI } = require('@google/generative-ai');
app.use(express.json());
app.use(cors());


app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

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

  try {
    const genAI = new GoogleGenerativeAI(gemini_bearer);
    // const model = genAI.getGenerativeModel({ model: 'gemini-1.0-pro' });
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `Summarize the following text and extract the relevant key phrases and return only a JSON object with one attribute 'Keywords' and in which the keywords attribute consists of the generated key phrases which can be used in searching educational resources: ${inputText}`;
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    // Parse JSON with error handling
    try {
      const jsonString = text.trim().replace(/^```json\n|\n```$/g, '');
      const parsedResult = JSON.parse(jsonString);
      const keywords = parsedResult.Keywords;
      res.json({ Keywords: keywords });
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      res.status(500).json({ error: 'An error occurred while processing the request' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing the request' });
  }
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

let allResults = [];
async function extractDataFromPage(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('.result-list .result.even, .result-list .result.odd').each((index, element) => {
    const extractData = {};
    const titleElement = $(element).find('.result-title span[data-bind="html: title"]');
    if (titleElement.length) {
      extractData.Title = titleElement.text().replace(/\s+/g, ' ').trim();
    } else {
      extractData.Title = "";
    }

    const linkElement = $(element).find('.result-title');
    extractData.Link = linkElement.attr('href') || "";

    const sourceNameElement = $(element).find('[data-bind="html: sourceName"]');
    extractData.SourceName = sourceNameElement.text().trim();

    const authorElement = $(element).find('[id^="authors-result_"]');
    extractData.Author = authorElement.text().trim();

    const dateElement = $(element).find('[data-bind="foreach: dates"] [data-bind="html: value"]');
    extractData.Date = dateElement.text().trim();

    let keywordsElement = "";
    $(element).find('div').each((i, div) => {
      if ($(div).text().includes('Keywords:')) {
        keywordsElement = $(div).find('span[data-bind*="keywords.join"]');
        return false;
      }
    });
    extractData.Keywords = keywordsElement ? keywordsElement.text().split(',').map(keyword => keyword.trim()) : "";

    const descriptionElement = $(element).find('.result-snippet');
    extractData.Description = descriptionElement.text().trim();

    results.push(extractData);
  });

  return results;
}

async function scrapeData(phrase, maxRetries = 3) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const agent = new https.Agent({  
        rejectUnauthorized: false
      });

      const baseUrl = 'https://oer.deepwebaccess.com/oer/desktop/en/search.html';
      const response = await axios.get(baseUrl,{httpsAgent:agent});
      const $ = cheerio.load(response.data);

      const searchResponse = await axios.post(baseUrl, new URLSearchParams({
        'FULLRECORD': phrase,
        'CurrentPage': '1',
        'ResultsPerPage': '20'
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        }
      },{httpsAgent:agent});

      let phraseResults = [];
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        console.log(`Extracting data from page ${pageNum} for phrase: ${phrase}...`);
        const pageResults = await extractDataFromPage(searchResponse.data);
        phraseResults = phraseResults.concat(pageResults);

        if (pageNum < 3) {
          const nextPageResponse = await axios.post(baseUrl, new URLSearchParams({
            'FULLRECORD': phrase,
            'CurrentPage': (pageNum + 1).toString(),
            'ResultsPerPage': '20'
          }), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest'
            }
          },{httpsAgent:agent});
          searchResponse.data = nextPageResponse.data;
        }
      }

      allResults = allResults.concat(phraseResults);
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
    const command = `python script.py "${inputText}" "${user_input}" "${hf_bearer_token}"`;
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
