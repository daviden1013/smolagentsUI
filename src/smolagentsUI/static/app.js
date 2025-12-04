const socket = io();
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let isGenerating = false;
let currentStepContainer = null; // The container for the current active step
let currentStreamText = "";      // Buffer for text coming in

// --- UI Helpers ---

function createMessageBubble(role) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = role === 'user' ? '👤' : '🤖';
    
    const content = document.createElement('div');
    content.className = 'content';
    
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(content);
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return content;
}

function ensureAgentContainer() {
    let lastMsg = chatContainer.lastElementChild;
    if (!lastMsg || !lastMsg.classList.contains('agent')) {
        return createMessageBubble('agent');
    }
    return lastMsg.querySelector('.content');
}

// Creates a placeholder for streaming text before we know it's a "Step"
function getOrCreateStepContainer() {
    if (!currentStepContainer) {
        const container = ensureAgentContainer();
        
        // Create a temporary thinking box
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

// Transforms the temporary streaming text into a nice collapsible step
function finalizeStep(stepNumber, code, logs, images, error) {
    if (!currentStepContainer) return;

    const container = currentStepContainer.parentElement;
    
    // Remove the temporary streaming text/container
    currentStepContainer.remove();
    currentStepContainer = null;
    currentStreamText = "";

    // Create the permanent collapsible details
    const details = document.createElement('details');
    details.className = 'step';
    if(error) details.classList.add('error');
    
    // Determine title
    const summary = document.createElement('summary');
    summary.textContent = error ? `Step ${stepNumber} (Failed)` : `Step ${stepNumber}`;
    
    const body = document.createElement('div');
    body.className = 'step-content';
    
    let htmlContent = "";
    
    // 1. The Thought/Code (Rendered Markdown)
    if (code) {
        htmlContent += `<div class="code-block">${marked.parse(code)}</div>`;
    }
    
    // 2. The Logs/Observations
    if (logs) {
        htmlContent += `<div class="logs"><strong>Observation:</strong>\n${logs}</div>`;
    }
    
    // 3. Images
    if (images && images.length > 0) {
        images.forEach(img => {
            htmlContent += `<br><img src="${img}" class="agent-image"><br>`;
        });
    }

    // 4. Errors
    if (error) {
        htmlContent += `<div class="error-msg"><strong>Error:</strong> ${error}</div>`;
    }

    body.innerHTML = htmlContent;
    details.appendChild(summary);
    details.appendChild(body);
    
    container.appendChild(details);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Event Listeners ---

sendBtn.addEventListener('click', () => {
    if (isGenerating) return;
    const text = userInput.value.trim();
    if (!text) return;

    createMessageBubble('user').textContent = text;
    userInput.value = '';
    isGenerating = true;
    
    socket.emit('start_run', { message: text });
});

// --- Socket Events ---

socket.on('agent_start', () => {
    // Prepare UI for new response
});

socket.on('stream_delta', (data) => {
    const div = getOrCreateStepContainer();
    
    // We append raw text to the buffer
    currentStreamText += data.content;
    
    // Update UI - using pre-wrap style to preserve formatting without full markdown parsing on every char
    // This is much faster and prevents flickering
    div.textContent = currentStreamText; 
    
    // Auto-scroll
    chatContainer.scrollTop = chatContainer.scrollHeight;
});

socket.on('tool_start', (data) => {
    // Optional: Update the "Thinking..." text to show what tool is being called
    const div = getOrCreateStepContainer();
    // Only update if we haven't generated a lot of text yet
    if (currentStreamText.length < 50) {
        div.innerHTML = `<span class="spinner">⚙️</span> Calling ${data.tool_name}...`;
    }
});

socket.on('action_step', (data) => {
    // Use the buffered text (currentStreamText) as the 'Code/Thought' content if code is missing, 
    // but usually 'data.code' contains the full python snippet from the agent.
    finalizeStep(
        data.step_number, 
        data.code, 
        data.observations, 
        data.images, 
        data.error
    );
});

socket.on('final_answer', (data) => {
    // Ensure any dangling stream is cleared
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
});

socket.on('run_complete', () => {
    isGenerating = false;
});

socket.on('error', (data) => {
    const container = ensureAgentContainer();
    container.innerHTML += `<div class="error-msg">System Error: ${data.message}</div>`;
    isGenerating = false;
});