/* src/smolagentsUI/static/app.js */
const socket = io();
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');

let isGenerating = false;
let currentStepContainer = null; 
let currentStreamText = "";

// --- UI Helpers ---

function createMessageBubble(role, htmlContent = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = role === 'user' ? '👤' : '🤖';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (htmlContent) {
        contentDiv.innerHTML = htmlContent;
    }
    
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentDiv);
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return contentDiv;
}

function ensureAgentContainer() {
    let lastMsg = chatContainer.lastElementChild;
    if (!lastMsg || !lastMsg.classList.contains('agent')) {
        return createMessageBubble('agent');
    }
    return lastMsg.querySelector('.content');
}

// Creates a placeholder for streaming text
function getOrCreateStepContainer() {
    if (!currentStepContainer) {
        const container = ensureAgentContainer();
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'step-thinking';
        thinkingDiv.innerHTML = '<span class="spinner">⚡</span> Thinking...';
        container.appendChild(thinkingDiv);
        currentStepContainer = thinkingDiv;
        currentStreamText = "";
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    return currentStepContainer;
}

function renderStep(stepNumber, modelOutput, code, logs, images, error) {
    // 1. Determine where to put the step
    let container;
    
    if (currentStepContainer) {
        // LIVE MODE: Replace the "Thinking..." box
        container = currentStepContainer.parentElement;
        currentStepContainer.remove();
        currentStepContainer = null;
        currentStreamText = "";
    } else {
        // HISTORY MODE: Just append to the last agent bubble
        container = ensureAgentContainer();
    }

    // 2. Create the collapsible details
    const details = document.createElement('details');
    details.className = 'step';
    if(error) details.classList.add('error');
    
    const summary = document.createElement('summary');
    summary.textContent = error ? `Step ${stepNumber} (Failed)` : `Step ${stepNumber}`;
    
    const body = document.createElement('div');
    body.className = 'step-content';
    
    let htmlContent = "";
    
    // Add the model output (thought)
    if (modelOutput) {
        htmlContent += `<div class="model-output" style="margin-bottom: 10px; border-bottom: 1px dashed #444; padding-bottom: 10px;">${marked.parse(modelOutput)}</div>`;
    }

    // Wrap code in python markdown fences for nice rendering
    if (code) {
        const fencedCode = "```python\n" + code + "\n```";
        htmlContent += `<div class="code-block">${marked.parse(fencedCode)}</div>`;
    }
    
    if (logs) htmlContent += `<div class="logs"><strong>Observation:</strong>\n${logs}</div>`;
    
    if (images && images.length > 0) {
        images.forEach(img => {
            // Check if it's a full data URL or just base64
            const src = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
            htmlContent += `<br><img src="${src}" class="agent-image"><br>`;
        });
    }

    if (error) htmlContent += `<div class="error-msg"><strong>Error:</strong> ${error}</div>`;

    body.innerHTML = htmlContent;
    details.appendChild(summary);
    details.appendChild(body);
    
    container.appendChild(details);

    // 3. Highlight code blocks inside this step
    details.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Socket Events: Chat Lifecycle ---

socket.on('connect', () => {
    console.log("Connected to server");
    // Request history list immediately on connect
    socket.emit('get_history');
});

socket.on('history_list', (data) => {
    historyList.innerHTML = ''; // Clear current list
    
    // Add "New Chat" button at the top
    const newChatBtn = document.createElement('div');
    newChatBtn.className = 'history-item new-chat';
    newChatBtn.innerHTML = '+ New Chat';
    newChatBtn.onclick = () => {
        socket.emit('new_chat');
    };
    historyList.appendChild(newChatBtn);

    // Populate sessions
    data.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div style="font-weight:bold">${session.preview}</div>
            <div style="font-size:0.8em; opacity:0.7">${session.timestamp}</div>
        `;
        item.onclick = () => loadSession(session.id);
        historyList.appendChild(item);
    });
});

function loadSession(id) {
    socket.emit('load_session', { id: id });
}

socket.on('reload_chat', (data) => {
    // Clear the chat window
    chatContainer.innerHTML = '';
    
    // Iterate through steps and render
    data.steps.forEach(step => {
        if ("task" in step) {
            createMessageBubble('user').textContent = step.task;
        } 
        else if ("step_number" in step) {
            renderStep(
                step.step_number, 
                step.model_output, // Pass model output
                step.code_action, 
                step.observations, 
                step.images, 
                step.error
            );
            
        
            if (step.is_final_answer) {
                const container = ensureAgentContainer();
                const div = document.createElement('div');
                div.className = 'final-answer';
                
                const finalContent = step.action_output || ""; 

                if (step.is_image) {
                    const src = finalContent.startsWith('data:') ? finalContent : `data:image/png;base64,${finalContent}`;
                    div.innerHTML = `<strong>Final Answer:</strong><br><img src="${src}" class="agent-image">`;
                } else {
                    div.innerHTML = marked.parse(String(finalContent));
                }
                container.appendChild(div);
            }
        }
    });
    chatContainer.scrollTop = chatContainer.scrollHeight;
});


// --- Socket Events: Streaming ---

sendBtn.addEventListener('click', () => {
    if (isGenerating) return;
    const text = userInput.value.trim();
    if (!text) return;

    createMessageBubble('user').textContent = text;
    userInput.value = '';
    isGenerating = true;
    
    socket.emit('start_run', { message: text });
});

// Handle Enter key to send, Shift+Enter for newline
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent the default newline insertion
        sendBtn.click();    // Trigger the send logic
    }
});

socket.on('stream_delta', (data) => {
    const div = getOrCreateStepContainer();
    currentStreamText += data.content;
    div.textContent = currentStreamText; 
    chatContainer.scrollTop = chatContainer.scrollHeight;
});

socket.on('tool_start', (data) => {
    const div = getOrCreateStepContainer();
    if (currentStreamText.length < 50) {
        div.innerHTML = `<span class="spinner">⚙️</span> Calling ${data.tool_name}...`;
    }
});

socket.on('action_step', (data) => {
    renderStep(
        data.step_number, 
        data.model_output, // Pass model output
        data.code_action, 
        data.observations, 
        data.images, 
        data.error
    );
});

socket.on('final_answer', (data) => {
    if (currentStepContainer) currentStepContainer.remove();
    const container = ensureAgentContainer();
    const div = document.createElement('div');
    div.className = 'final-answer';
    
    if (data.type === 'image') {
        div.innerHTML = `<strong>Final Answer:</strong><br><img src="${data.content}" class="agent-image">`;
    } else {
        div.innerHTML = marked.parse(data.content);
    }
    container.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    isGenerating = false;
    
    // Refresh history list to show the new save
    socket.emit('get_history');
});

socket.on('run_complete', () => { isGenerating = false; });
socket.on('error', (data) => { alert(data.message); isGenerating = false; });