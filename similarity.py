import sys
import json

# Removes duplicates based on the unique titles and links
def check_unique_items(json_data):
    seen_titles = set()
    seen_links = set()
    unique_items = []
    count=0
    for item in json_data:

        title = item.get('Title')
        link = item.get('Link')

        if ((title not in seen_titles) and (link not in seen_links)):
            seen_titles.add(title)
            seen_links.add(link)
            unique_items.append(item)
        else:
            count+=1
    print("Removed "+str(count)+" items")
    return unique_items

# Performing API calls to HuggingFace to gather 
def clean_unique_items(json_data,userDescription,token):
    import requests
    import time

    API_URL = "https://api-inference.huggingface.co/models/Sakil/sentence_similarity_semantic_search"
    headers = {"Authorization": "Bearer "+token}

    def query(payload):
        response = requests.post(API_URL, headers=headers, json=payload)
        return response.json()

    def wait_for_model(payload, max_retries=10, wait_time=30):
        retries = 0
        while retries < max_retries:
            output = query(payload)
            # Check if the model is still processing and will wait and re-attempt to get a response
            if 'error' in output and 'currently loading' in output['error']:
                print(f"Model is loading. Waiting for {wait_time} seconds...")
                time.sleep(wait_time)
                retries += 1
            else:
                return output
        raise Exception("Model did not load in the expected time frame")
    sentences=[]

    for item in json_data:
        sentences.append(item["Title"]) 
        sentences.append(item["Description"])
    payload = {
        "inputs": {
        "source_sentence": userDescription,
        "sentences": sentences
    },
    }

    output = wait_for_model(payload)

    final=[]
    for i in range(0,len(output)-1,2):
        if(max(output[i],output[i+1])>=0.4):
            final.append((json_data[i//2],max(output[i],output[i+1])))
            
    final_list = [item[0] for item in final]        
    print("Removed "+str(len(json_data)-len(final))+" entries")
    return final_list
    

def main():
    file_path= sys.argv[1]
    userDescription = sys.argv[2]
    HF_bearer_token = sys.argv[3]

    # Loading the file into a JSON variable
    with open(file_path, 'r', encoding="utf-8") as file:
        data = json.load(file)

    unique_items = check_unique_items(data)
    print("Scraping done")

    cleaned_items = clean_unique_items(unique_items,userDescription,HF_bearer_token)

    # Saving the JSON value into a file
    with open(file_path, 'w', encoding="utf-8") as file:
        json.dump(cleaned_items, file, ensure_ascii=False, indent=4)

    print("Cleaning done")

if __name__ == "__main__":
    main()
