// injected.js is now injected directly via manifest.json into the MAIN world

// Replace this with your actual Gemini API key for testing
const HARDCODED_API_KEY = "AIzaSyAtt9yHAs_szOtN-Y7uafFzKjcDOGJBW3c";

let lastResponseData = null;
let hasAutoCopied = false;

// Listen for messages from the injected script
window.addEventListener('message', function(event) {
    // Only accept messages from the same window
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'HILFE_INTERCEPTED_DATA') {
        const text = event.data.data;
        
        try {
            // Check if this is the large assessment data
            const json = JSON.parse(text);
            if (json && json.data && Array.isArray(json.data.questions)) {
                console.log("Hilfe: Found the main assessment data from", event.data.url);
                lastResponseData = text;
                console.log("Hilfe: Assessment data updated silently. Press Alt+Q to extract.");
            } else {
                console.log("Hilfe: Ignored minor request to", event.data.url);
            }
        } catch(e) {
            // If it's not JSON, we ignore it to avoid overwriting the good data
            console.log("Hilfe: Ignored non-JSON request to", event.data.url);
        }
    }
});

// Listen for manual trigger from the extension icon
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'MANUAL_TRIGGER') {
            if (lastResponseData) {
                copyToClipboard(lastResponseData, "Last response manually copied!");
            } else {
                showNotification("No response intercepted yet. Please trigger the network request first.", true);
            }
        }
    });
}

function copyToClipboard(text, successMessage) {
    const formattedText = formatData(text);
    
    navigator.clipboard.writeText(formattedText).then(() => {
        console.log("Hilfe: " + successMessage);
        showNotification(successMessage, false);
    }).catch(err => {
        console.error("Hilfe: Failed to copy text. Error: ", err);
        showNotification("Failed to copy text. Please focus the page.", true);
    });
}

// --- AUTO SOLVER LOGIC ---
document.addEventListener('keydown', (event) => {
    // Alt + K to set API Key
    if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code === 'KeyK') {
        event.preventDefault();
        const key = prompt("Enter your free Gemini API Key (get one from aistudio.google.com):");
        if (key) {
            chrome.storage.local.set({ 'geminiApiKey': key.trim() }, () => {
                showNotification("API Key saved securely!", false);
            });
        }
    }

    // Alt + Q to manually extract data
    if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code === 'KeyQ') {
        event.preventDefault();
        if (lastResponseData) {
            copyToClipboard(lastResponseData, "Assessment data extracted to clipboard!");
        } else {
            showNotification("No response intercepted yet.", true);
        }
    }

    // Alt + S to auto-solve
    if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code === 'KeyS') {
        event.preventDefault();
        autoSolveQuestion();
    }
});

async function callGeminiAPI(questionText, optionsArr, explanationText, apiKey) {
    const promptText = `
You are an expert test solver.
Question: ${questionText}
Options: 
${optionsArr.map((o, i) => `${i}: ${o}`).join('\n')}
Explanation (if available): ${explanationText || 'None'}

Determine the correct option. 
Return ONLY the single integer index (0, 1, 2, etc.) of the correct option. Do not output any other text, no markdown, just the number.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 }
        })
    });
    
    if (!response.ok) throw new Error("API Request Failed");
    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text.trim();
    return parseInt(text);
}

async function autoSolveQuestion() {
    if (!lastResponseData) {
        showNotification("No assessment data found. Refresh page first.", true);
        return;
    }
    
    try {
        const json = JSON.parse(lastResponseData);
        if (!json || !json.data || !Array.isArray(json.data.questions)) return;
        
        const options = document.querySelectorAll('input[type="radio"], [role="radio"], input[type="checkbox"], [role="checkbox"], .checkmark1');
        
        if (options.length === 0) {
            showNotification("Could not find any clickable options on the screen.", true);
            return;
        }

        let pageOptionTexts = [];
        options.forEach(opt => {
            let label = opt.closest('label') || opt.parentElement;
            if (label) pageOptionTexts.push(label.innerText.trim().toLowerCase());
        });

        let matchedQuestion = null;
        for (let q of json.data.questions) {
            if (q.multipleChoiceOptions && q.multipleChoiceOptions.options) {
                let matchCount = 0;
                q.multipleChoiceOptions.options.forEach(jsonOpt => {
                    if (pageOptionTexts.some(pageText => pageText.includes(jsonOpt.toLowerCase()) || jsonOpt.toLowerCase().includes(pageText))) {
                        matchCount++;
                    }
                });
                if (matchCount >= 2) {
                    matchedQuestion = q;
                    break;
                }
            }
        }

        if (!matchedQuestion) {
            showNotification("Could not match the current question with the JSON data.", true);
            return;
        }

        let bestIndex = -1;

        // 1. Try to extract from questionProgress array (Past saved answers)
        if (json.data.questionProgress && Array.isArray(json.data.questionProgress)) {
            const progress = json.data.questionProgress.find(p => p.question && p.question._id === matchedQuestion._id);
            if (progress && progress.solution && Array.isArray(progress.solution.multipleChoiceSolution) && progress.solution.multipleChoiceSolution.length > 0) {
                bestIndex = parseInt(progress.solution.multipleChoiceSolution[0]) - 1;
                console.log(`Hilfe: Found exact answer from questionProgress: Index ${bestIndex}`);
            }
        }

        // 2. Fallback to API if we have a key
        if (bestIndex === -1) {
            const result = await new Promise(resolve => chrome.storage.local.get(['geminiApiKey'], resolve));
            const apiKeyToUse = HARDCODED_API_KEY !== "YOUR_API_KEY_HERE" ? HARDCODED_API_KEY : result.geminiApiKey;

            if (apiKeyToUse) {
                showNotification("Asking AI for the answer...", false);
                try {
                    bestIndex = await callGeminiAPI(
                        matchedQuestion.description || matchedQuestion.title, 
                        matchedQuestion.multipleChoiceOptions.options, 
                        matchedQuestion.explanation, 
                        apiKeyToUse
                    );
                    console.log(`Hilfe: AI confidently selected index ${bestIndex}`);
                } catch (err) {
                    console.error("AI API Error:", err);
                    showNotification("AI API Failed. Falling back to NLP...", true);
                }
            } else {
                showNotification("No API Key set. Update HARDCODED_API_KEY or press Alt+K. Falling back to local NLP...", true);
            }
        }

        // 3. Final Fallback to local NLP
        if (bestIndex === -1 && matchedQuestion.explanation) {
            bestIndex = findBestOptionByExplanation(matchedQuestion.multipleChoiceOptions.options, matchedQuestion.explanation);
            console.log(`Hilfe: Guessed answer from explanation NLP: Index ${bestIndex}`);
        }

        if (bestIndex >= 0 && bestIndex < options.length) {
            options[bestIndex].click();
            options[bestIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            options[bestIndex].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            showNotification(`Auto-Solved! Selected Option ${bestIndex + 1}`, false);
        } else {
            showNotification("Could not confidently determine the answer.", true);
        }

    } catch (e) {
        console.error(e);
        showNotification("Auto-solver encountered an error.", true);
    }
}

function findBestOptionByExplanation(options, explanation) {
    const stopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was", "will", "with"]);
    const getWords = (text) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    
    const expWords = getWords(explanation);
    let bestIndex = -1;
    let maxOverlap = -1;
    
    options.forEach((opt, index) => {
        const optWords = getWords(opt);
        let overlap = 0;
        
        optWords.forEach(word => {
            if (expWords.includes(word)) overlap += 2;
            else {
                expWords.forEach(ew => {
                    if (ew.includes(word) || word.includes(ew)) overlap += 0.5;
                });
            }
        });
        
        if (overlap > maxOverlap) {
            maxOverlap = overlap;
            bestIndex = index;
        }
    });
    
    return bestIndex;
}
// -------------------------

function formatData(rawData) {
    try {
        const json = JSON.parse(rawData);
        if (json && json.data && Array.isArray(json.data.questions)) {
            let output = `${json.data.title || json.data.name || 'Assessment'}\n`;
            output += `====================================================\n\n`;
            
            json.data.questions.forEach((q, index) => {
                // Remove HTML tags or weird formatting if present (basic cleanup)
                const cleanDesc = q.description ? q.description.replace(/<[^>]*>?/gm, '').trim() : '';
                
                output += `Q${index + 1}: ${q.title || 'Question'}\n`;
                output += `${cleanDesc}\n\n`;
                
                if (q.multipleChoiceOptions && q.multipleChoiceOptions.options) {
                    output += `Options:\n`;
                    q.multipleChoiceOptions.options.forEach((opt, i) => {
                        output += `  ${String.fromCharCode(65 + i)}) ${opt}\n`;
                    });
                    output += `\n`;
                }
                
                if (q.explanation) {
                    const cleanExp = q.explanation.replace(/<[^>]*>?/gm, '').trim();
                    output += `Answer / Explanation:\n${cleanExp}\n`;
                }
                
                output += `\n----------------------------------------------------\n\n`;
            });
            return output;
        }
    } catch(e) {
        // If it's not valid JSON or doesn't match the structure, just fall back to raw data
        console.log("Hilfe: Data is not in the expected JSON format, copying raw text.");
    }
    return rawData;
}

function showNotification(message, isError = false) {
    const div = document.createElement('div');
    div.textContent = message;
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.right = '20px';
    div.style.padding = '12px 24px';
    div.style.background = isError ? '#f44336' : '#4CAF50'; // Red for error, Green for success
    div.style.color = 'white';
    div.style.borderRadius = '5px';
    div.style.zIndex = '999999';
    div.style.fontFamily = 'sans-serif';
    div.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    div.style.fontWeight = 'bold';
    
    document.body.appendChild(div);
    
    // Remove the notification after 3 seconds
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.5s ease';
        setTimeout(() => div.remove(), 500);
    }, 3000);
}
