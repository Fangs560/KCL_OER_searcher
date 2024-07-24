from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
import time
import json
import sys

all_results = []

def extract_data_from_page(driver,max_retries=3):
    for attempt in range(max_retries):
        try:
            WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.CLASS_NAME, 'result-list')))
            
            # Find all result elements
            result_elements = driver.find_elements(By.CSS_SELECTOR, '.result-list .result.even, .result-list .result.odd')
            
            extract_data_array = []
            
            for result in result_elements:
                extract_data = {}
                
                # Extract Title
                title_element = result.find_element(By.CSS_SELECTOR, '.result-title span[data-bind="html: title"]')
                if title_element:
                    # Clone and clean up the title
                    title_text = driver.execute_script("""
                        var el = arguments[0];
                        var clone = el.cloneNode(true);
                        var highlights = clone.querySelectorAll('span.hlt');
                        for (var i = 0; i < highlights.length; i++) {
                            highlights[i].replaceWith(highlights[i].textContent);
                        }
                        return clone.textContent;
                    """, title_element)
                    extract_data['Title'] = title_text.strip()
                else:
                    extract_data['Title'] = ""
                
                # Extract Link
                try:
                    link_element = result.find_element(By.CSS_SELECTOR, '.result-title')
                    extract_data['Link'] = link_element.get_attribute('href') if link_element else ""
                except:
                    extract_data['Link'] = ""
                
                # Extract SourceName
                try:
                    source_name_element = result.find_element(By.CSS_SELECTOR, '[data-bind="html: sourceName"]')
                    extract_data['SourceName'] = source_name_element.text.strip() if source_name_element else ""
                except:
                    extract_data['SourceName'] = ""
                
                # Extract Author
                try:
                    author_element = result.find_element(By.CSS_SELECTOR, '[id^="authors-result_"]')
                    extract_data['Author'] = author_element.text.strip() if author_element else ""
                except:
                    extract_data['Author'] = ""

                # Extract Date
                try:
                    date_element = result.find_element(By.CSS_SELECTOR, '[data-bind="foreach: dates"] [data-bind="html: value"]')
                    extract_data['Date'] = date_element.text.strip() if date_element else ""
                except:
                    extract_data['Date'] = ""
                
                # Extract Keywords
                keywords_element = None
                div_elements = result.find_elements(By.TAG_NAME, 'div')
                for div in div_elements:
                    try:
                        if 'Keywords:' in div.text:
                            keywords_element = div.find_element(By.CSS_SELECTOR, 'span[data-bind*="keywords.join"]')
                            break
                    except:
                        extract_data['Keywords'] = []
                        break

                if keywords_element:
                    extract_data['Keywords'] = [keyword.strip() for keyword in keywords_element.text.split(',')]
                else:
                    extract_data['Keywords'] = []
                
                # Extract Description
                try:
                    description_element = result.find_element(By.CSS_SELECTOR, '.result-snippet')
                    extract_data['Description'] = description_element.text.strip() if description_element else ""
                except:
                    extract_data['Description'] = ""

                extract_data_array.append(extract_data)
            
            # print('Extracted results!')
            return extract_data_array
        
        except StaleElementReferenceException:
            if attempt < max_retries - 1:
                # print(f"Stale element encountered. Retrying... (Attempt {attempt + 1})")
                time.sleep(2)  # Wait a bit before retrying
            else:
                # print("Max retries reached. Unable to extract data.")
                return []

        except Exception as error:
            # print('Error extracting data from page:', str(error))
            return []
    
def scrape_data(phrase, max_retries=3):
    global all_results
    attempts = 0
    while attempts < max_retries:
        try:
            options = webdriver.ChromeOptions()
            options.add_argument('--headless')
            driver = webdriver.Chrome(options=options)
            driver.get('https://oer.deepwebaccess.com/oer/desktop/en/search.html')

            WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.ID, 'FULLRECORD')))
            # print(f"Page loaded for phrase: {phrase}")
            search_input = driver.find_element(By.ID, 'FULLRECORD')
            search_input.send_keys(phrase)
            search_input.send_keys(Keys.RETURN)

            WebDriverWait(driver, 60).until(EC.visibility_of_element_located((By.ID, 'add-results-modal')))
            WebDriverWait(driver, 60).until(EC.element_to_be_clickable((By.CSS_SELECTOR, '#add-results-modal .btn.btn-primary')))
            driver.find_element(By.CSS_SELECTOR, '#add-results-modal .btn.btn-primary').click()
            # print(f"Got additional results for phrase: {phrase}")

            phrase_results = []
            for page_num in range(1, 4):
                # print(f"Extracting data from page {page_num} for phrase: {phrase}...")
                page_results = extract_data_from_page(driver)
                phrase_results.extend(page_results)
                # if page_num < 3:
                try:
                    expected_start_num = page_num * 20 + 1
                    next_button = WebDriverWait(driver, 5).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, 'li:not(.disabled) a[data-bind="click: function(){ CurrentPage(CurrentPage() + 1); }"]'))
                    )
                    driver.execute_script("arguments[0].click();", next_button)
                    WebDriverWait(driver, 5).until(
                        lambda d: int(d.find_element(By.CSS_SELECTOR, '#current-results span[data-bind="count: startNum"]').text) == expected_start_num
                    )
                except TimeoutException:
                    # print(f"Error navigating to page {page_num + 1} for phrase: {phrase}")
                    break

            all_results.extend(phrase_results)
            driver.quit()
            break
        except Exception as error:
            attempts += 1
            # print(f"Attempt {attempts} failed for phrase: {phrase}", str(error))
            if attempts >= max_retries:
                # print(f"Max retries reached for phrase: {phrase}.")
                raise error

# Example usage
if __name__ == "__main__":
    try:
        phrase = sys.argv[1] if len(sys.argv) > 1 else "default phrase"
        scrape_data(phrase)
        print(json.dumps(all_results))
    except Exception as e:
        print(json.dumps({"error": str(e)})) 