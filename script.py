import sys
import json

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
            # Check if the model is still loading
            # {'error': 'Model Sakil/sentence_similarity_semantic_search is currently loading', 'estimated_time': 20.0}
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

    final.sort(key=lambda x: x[1], reverse=True)
    final_list = [item[0] for item in final]        

    print("Removed "+str(len(json_data)-len(final))+" entries")
    return final_list
    

def main():
    choice = sys.argv[1]

    if(choice == "1"):
        file_path= sys.argv[2]
        userDescription = sys.argv[3]
        HF_bearer_token = sys.argv[4]

        with open(file_path, 'r', encoding="utf-8") as file:
            data = json.load(file)

        unique_items = check_unique_items(data)
        print("Scraping done")

        cleaned_items = clean_unique_items(unique_items,userDescription,HF_bearer_token)

        with open(file_path, 'w', encoding="utf-8") as file:
            json.dump(cleaned_items, file, ensure_ascii=False, indent=4)

        print("Cleaning done")
    
    elif(choice == "2"):
        import google.generativeai as genai
        input_text = sys.argv[2]
        genai.configure(api_key=sys.argv[3])

        model = genai.GenerativeModel('gemini-1.0-pro')

        response = model.generate_content("Summarize the following text and extract the relevant key phrases and return only a JSON object with one attribute 'Keywords' and in which the keywords attribute consists of the generated key phrases which can be used in searching educational resources: "+ input_text)
        result = json.loads(' '.join(response.text.split()[1:-1]))
        Keyphrases = result["Keywords"]
        print(json.dumps({'Keywords':Keyphrases}))

if __name__ == "__main__":
    main()
