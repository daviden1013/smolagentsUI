/* src/smolagentsUI/static/app.js */
const socket = io();
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMsg = document.getElementById('modal-msg');
const modalInput = document.getElementById('modal-input');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

let isGenerating = false;
let currentStepContainer = null; 
let currentStreamText = "";

// Modal State
let currentModalAction = null; // 'rename' or 'delete'
let targetSessionId = null;

// --- Modal Helpers ---

function closeModal() {
    modalOverlay.classList.remove('visible');
    currentModalAction = null;
    targetSessionId = null;
    modalInput.value = '';
}

function showRenameModal(id, currentName) {
    currentModalAction = 'rename';
    targetSessionId = id;
    
    modalTitle.textContent = "Rename Chat";
    modalMsg.style.display = 'none';
    
    modalInput.style.display = 'block';
    modalInput.value = currentName;
    
    modalConfirmBtn.textContent = "Save";
    modalConfirmBtn.classList.remove('danger');
    
    modalOverlay.classList.add('visible');
    modalInput.focus();
}

function showDeleteModal(id) {
    currentModalAction = 'delete';
    targetSessionId = id;
    
    modalTitle.textContent = "Delete Chat";
    modalMsg.textContent = "Are you sure you want to delete this conversation? This action cannot be undone.";
    modalMsg.style.display = 'block';
    
    modalInput.style.display = 'none';
    
    modalConfirmBtn.textContent = "Delete";
    modalConfirmBtn.classList.add('danger');
    
    modalOverlay.classList.add('visible');
}

// Modal Event Listeners
modalCancelBtn.onclick = closeModal;
modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

modalConfirmBtn.onclick = () => {
    if (!targetSessionId) return;
    
    if (currentModalAction === 'rename') {
        const newName = modalInput.value.trim();
        if (newName) {
            socket.emit('rename_session', { id: targetSessionId, new_name: newName });
        }
    } else if (currentModalAction === 'delete') {
        socket.emit('delete_session', { id: targetSessionId });
    }
    closeModal();
};

// Handle Enter key in modal input
modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modalConfirmBtn.click();
});


// --- UI Helpers (Chat) ---

function createMessageBubble(role, htmlContent = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (htmlContent) {
        contentDiv.innerHTML = htmlContent;
    }
    
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
    let container;
    
    if (currentStepContainer) {
        container = currentStepContainer.parentElement;
        currentStepContainer.remove();
        currentStepContainer = null;
        currentStreamText = "";
    } else {
        container = ensureAgentContainer();
    }

    const details = document.createElement('details');
    details.className = 'step';
    if(error) details.classList.add('error');
    
    const summary = document.createElement('summary');
    summary.textContent = error ? `Step ${stepNumber} (Failed)` : `Step ${stepNumber}`;
    
    const body = document.createElement('div');
    body.className = 'step-content';
    
    let htmlContent = "";
    
    if (modelOutput) {
        const thoughtContent = modelOutput.replace(/<code>[\s\S]*?<\/code>/g, "").trim();
        if (thoughtContent) {
            htmlContent += `<div class="model-output" style="margin-bottom: 10px; border-bottom: 1px dashed #444; padding-bottom: 10px;">${marked.parse(thoughtContent)}</div>`;
        }
    }

    if (code) {
        const fencedCode = "```python\n" + code + "\n```";
        htmlContent += `<div class="code-block">${marked.parse(fencedCode)}</div>`;
    }
    
    if (logs) htmlContent += `<div class="logs"><strong>Observation:</strong>\n${logs}</div>`;
    
    if (images && images.length > 0) {
        images.forEach(img => {
            const src = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
            htmlContent += `<br><img src="${src}" class="agent-image"><br>`;
        });
    }

    if (error) htmlContent += `<div class="error-msg"><strong>Error:</strong> ${error}</div>`;

    body.innerHTML = htmlContent;
    details.appendChild(summary);
    details.appendChild(body);
    
    container.appendChild(details);

    details.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Socket Events: Chat Lifecycle ---

socket.on('connect', () => {
    console.log("Connected to server");
    socket.emit('get_history');
});

socket.on('history_list', (data) => {
    historyList.innerHTML = ''; 
    
    // "New Chat" button
    const newChatBtn = document.createElement('div');
    newChatBtn.className = 'history-item new-chat';
    newChatBtn.innerHTML = '+ New Chat';
    newChatBtn.onclick = () => {
        socket.emit('new_chat');
    };
    historyList.appendChild(newChatBtn);

    // Populate sessions
    data.sessions.forEach(session => {
        // Container
        const item = document.createElement('div');
        item.className = 'history-item';
        
        // Text Content
        const textDiv = document.createElement('div');
        textDiv.className = 'history-item-text';
        textDiv.innerHTML = `
            <div style="font-weight:bold">${session.preview}</div>
            <div style="font-size:0.8em; opacity:0.7">${session.timestamp}</div>
        `;
        textDiv.onclick = () => loadSession(session.id);
        
        // Menu Button (...)
        const menuBtn = document.createElement('div');
        menuBtn.className = 'menu-btn';
        menuBtn.innerHTML = '⋮';
        
        // Context Menu
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        
        // Rename Option
        const renameOpt = document.createElement('div');
        renameOpt.className = 'context-menu-item';
        renameOpt.textContent = 'Rename';
        renameOpt.onclick = (e) => {
            e.stopPropagation(); 
            menu.classList.remove('visible');
            // Trigger Custom Modal
            showRenameModal(session.id, session.preview);
        };

        // Delete Option
        const deleteOpt = document.createElement('div');
        deleteOpt.className = 'context-menu-item delete';
        deleteOpt.textContent = 'Delete';
        deleteOpt.onclick = (e) => {
            e.stopPropagation(); 
            menu.classList.remove('visible');
            // Trigger Custom Modal
            showDeleteModal(session.id);
        };

        menu.appendChild(renameOpt);
        menu.appendChild(deleteOpt);

        // Toggle Menu Logic
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.context-menu.visible').forEach(m => {
                if (m !== menu) m.classList.remove('visible');
            });
            menu.classList.toggle('visible');
        };

        item.appendChild(textDiv);
        item.appendChild(menuBtn);
        item.appendChild(menu);
        historyList.appendChild(item);
    });
});

// Close context menus when clicking elsewhere
document.addEventListener('click', () => {
    document.querySelectorAll('.context-menu.visible').forEach(m => {
        m.classList.remove('visible');
    });
});

function loadSession(id) {
    socket.emit('load_session', { id: id });
}

socket.on('reload_chat', (data) => {
    chatContainer.innerHTML = '';
    
    data.steps.forEach(step => {
        if ("task" in step) {
            createMessageBubble('user').textContent = step.task;
        } 
        else if ("step_number" in step) {
            renderStep(
                step.step_number, 
                step.model_output,
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

userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); 
        sendBtn.click();    
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
        data.model_output, 
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
    
    socket.emit('get_history');
});

socket.on('run_complete', () => { isGenerating = false; });
socket.on('error', (data) => { alert(data.message); isGenerating = false; });