/* src/smolagentsUI/static/app.js */
const socket = io();
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');

// Global State
let isGenerating = false;
let currentStepContainer = null; 
let currentStreamText = "";
let currentSessionId = null; 
let agentSpecs = null; 

// --- Smart Scroll Logic ---
let isUserAtBottom = true; // Default to true so it scrolls initially

chatContainer.addEventListener('scroll', () => {
    const threshold = 50; // pixels from bottom to be considered "at bottom"
    isUserAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight <= threshold;
});

function scrollToBottom(force = false) {
    if (force || isUserAtBottom) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Icons
const ICON_SEND = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const ICON_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;

// --- UI Helpers (Button State) ---

function toggleSendButtonState(running) {
    isGenerating = running;
    if (running) {
        sendBtn.innerHTML = ICON_STOP;
        sendBtn.classList.add('stop');
        sendBtn.title = "Stop Agent";
    } else {
        sendBtn.innerHTML = ICON_SEND;
        sendBtn.classList.remove('stop');
        sendBtn.title = "Send message";
    }
}

// --- Chat Render Helpers ---

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
    
    // Force scroll if it's a user message, otherwise use smart scroll
    scrollToBottom(role === 'user');
    
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
        
        scrollToBottom();
    }
    return currentStepContainer;
}

function renderWelcomeScreen() {
    chatContainer.innerHTML = '';
    
    if (!agentSpecs) {
        chatContainer.innerHTML = `
            <div class="message system agent-profile">
                <div class="content">Agent ready. Type a task to begin.</div>
            </div>`;
        return;
    }

    const toolsList = agentSpecs.tools && agentSpecs.tools.length > 0 
        ? agentSpecs.tools.map(t => `<span style="background:#333; padding:2px 6px; border-radius:4px; font-size:0.9em; margin-right:4px;">${t}</span>`).join('') 
        : "None";

    const importsList = agentSpecs.imports && agentSpecs.imports.length > 0 
        ? agentSpecs.imports.map(i => 
            `<code style="background:#343541; padding:2px 6px; border-radius:4px; font-family:monospace; color: #e0e0e0;">${i}</code>`
          ).join('') 
        : "None";

    const html = `
        <div class="message system agent-profile" style="margin: auto; width: 100%; max-width: 600px;">
            <div class="content" style="background-color: #25262b; border: 1px solid #444; border-radius: 12px; padding: 25px; text-align: left;">
                <h3 style="margin-top:0; border-bottom:1px solid #444; padding-bottom:10px;">Agent Profile</h3>
                
                <div style="margin-top:15px;">
                    <strong>Model:</strong><br>
                    <span style="color: var(--accent); font-family: monospace;">${agentSpecs.model}</span>
                </div>

                <div style="margin-top:15px;">
                    <strong>Available Tools:</strong><br>
                    <div style="margin-top:5px;">${toolsList}</div>
                </div>

                <div style="margin-top:15px;">
                    <strong>Authorized Imports:</strong><br>
                    <div style="margin-top:5px; display: flex; flex-wrap: wrap; gap: 6px;">
                        ${importsList}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    chatContainer.innerHTML = html;
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
    
    scrollToBottom();
}

/**
 * Helper to recursively render content (strings, images, arrays, objects).
 */
function renderContentRecursive(container, content) {
    if (content === null || content === undefined) return;

    if (Array.isArray(content)) {
        content.forEach(item => {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '15px';
            wrapper.style.paddingLeft = '10px';
            wrapper.style.borderLeft = '2px solid #444'; 
            renderContentRecursive(wrapper, item);
            container.appendChild(wrapper);
        });
    } else if (typeof content === 'object') {
        Object.entries(content).forEach(([key, value]) => {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '15px';
            
            const label = document.createElement('div');
            label.style.fontWeight = 'bold';
            label.style.marginBottom = '6px';
            label.style.color = '#b4b4b4'; 
            label.style.fontSize = '0.9em';
            label.style.textTransform = 'capitalize';
            label.textContent = key.replace(/_/g, ' ') + ':';
            
            wrapper.appendChild(label);

            const valContainer = document.createElement('div');
            valContainer.style.marginLeft = '10px'; 
            renderContentRecursive(valContainer, value);
            wrapper.appendChild(valContainer);
            
            container.appendChild(wrapper);
        });
    } else {
        const str = String(content);
        if (str.trim().startsWith('data:image')) {
            const img = document.createElement('img');
            img.src = str;
            img.className = 'agent-image';
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            img.style.border = '1px solid #444';
            container.appendChild(img);
        } else {
            const textDiv = document.createElement('div');
            textDiv.innerHTML = marked.parse(str);
            textDiv.querySelectorAll('p:last-child').forEach(p => p.style.marginBottom = '0');
            container.appendChild(textDiv);
        }
    }
}

/**
 * Helper to render the final answer.
 */
function renderFinalAnswer(container, content) {
    const div = document.createElement('div');
    div.className = 'final-answer';
    
    const header = document.createElement('div');
    header.innerHTML = '<strong>Final Answer:</strong>';
    header.style.marginBottom = '12px';
    header.style.borderBottom = '1px solid #444';
    header.style.paddingBottom = '8px';
    div.appendChild(header);

    renderContentRecursive(div, content);
    
    div.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    container.appendChild(div);
    scrollToBottom();
}

// --- User Actions ---

sendBtn.addEventListener('click', () => {
    // STOP ACTION
    if (isGenerating) {
        socket.emit('stop_run', { session_id: currentSessionId });
        return;
    }

    // SEND ACTION
    const text = userInput.value.trim();
    if (!text) return;

    const profileMsg = chatContainer.querySelector('.agent-profile');
    if (profileMsg) {
        profileMsg.remove();
    }

    createMessageBubble('user').textContent = text;
    userInput.value = '';
    
    toggleSendButtonState(true);
    
    socket.emit('start_run', { 
        message: text,
        session_id: currentSessionId 
    });
});

userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); 
        sendBtn.click();    
    }
});


// --- Socket Events (Lifecycle) ---

socket.on('connect', () => {
    console.log("Connected to server");
    socket.emit('get_history');
    socket.emit('get_agent_specs'); 
});

socket.on('agent_specs', (data) => {
    agentSpecs = data;
    if (!currentSessionId && chatContainer.querySelectorAll('.message').length <= 1) {
        renderWelcomeScreen();
    }
});

socket.on('session_created', (data) => {
    if (!currentSessionId) {
        currentSessionId = data.id;
        console.log(`Assigned new Session ID: ${currentSessionId}`);
        socket.emit('get_history');
    }
});

socket.on('history_list', (data) => {
    historyList.innerHTML = ''; 
    
    const newChatBtn = document.createElement('div');
    newChatBtn.className = 'history-item new-chat';
    newChatBtn.innerHTML = '+ New Chat';
    newChatBtn.onclick = () => {
        socket.emit('new_chat');
    };
    historyList.appendChild(newChatBtn);

    data.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.id = session.id;
        if (session.id === currentSessionId) item.classList.add('active');
        
        const textDiv = document.createElement('div');
        textDiv.className = 'history-item-text';
        textDiv.innerHTML = `
            <div style="font-weight:bold">${session.preview}</div>
            <div style="font-size:0.8em; opacity:0.7">${session.timestamp}</div>
        `;
        textDiv.onclick = () => loadSession(session.id);
        
        const menuBtn = document.createElement('div');
        menuBtn.className = 'menu-btn';
        menuBtn.textContent = '⋮';
        
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        
        const renameOpt = document.createElement('div');
        renameOpt.className = 'context-menu-item';
        renameOpt.textContent = 'Rename';
        renameOpt.onclick = (e) => {
            e.stopPropagation(); 
            menu.classList.remove('visible');
            showRenameModal(session.id, session.preview);
        };

        const deleteOpt = document.createElement('div');
        deleteOpt.className = 'context-menu-item delete';
        deleteOpt.textContent = 'Delete';
        deleteOpt.onclick = (e) => {
            e.stopPropagation(); 
            menu.classList.remove('visible');
            showDeleteModal(session.id);
        };

        menu.appendChild(renameOpt);
        menu.appendChild(deleteOpt);

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

document.addEventListener('click', () => {
    document.querySelectorAll('.context-menu.visible').forEach(m => {
        m.classList.remove('visible');
    });
});

function loadSession(id) {
    if (isGenerating && id !== currentSessionId) {
    }
    
    currentSessionId = id;

    document.querySelectorAll('.history-item').forEach(el => {
        if (el.dataset.id === id) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    chatContainer.classList.add('loading');
    socket.emit('load_session', { id: id });
}

socket.on('reload_chat', (data) => {
    chatContainer.classList.remove('loading');

    chatContainer.innerHTML = '';
    
    if (data.id) currentSessionId = data.id;
    else currentSessionId = null; 

    toggleSendButtonState(false);

    if (!data.steps || data.steps.length === 0) {
        renderWelcomeScreen();
        return;
    }
    
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
                renderFinalAnswer(container, step.action_output);
            }
        }
    });
    
    // Always force scroll to bottom on reload
    scrollToBottom(true);
});


// --- Socket Events (Streaming & Logic) ---

function isForCurrentSession(data) {
    return data.session_id === currentSessionId;
}

socket.on('stream_delta', (data) => {
    if (!isForCurrentSession(data)) return;

    const div = getOrCreateStepContainer();
    currentStreamText += data.content;
    div.textContent = currentStreamText; 
    
    scrollToBottom();
});

socket.on('tool_start', (data) => {
    if (!isForCurrentSession(data)) return;

    const div = getOrCreateStepContainer();
    if (currentStreamText.length < 50) {
        div.innerHTML = `<span class="spinner">⚙️</span> Calling ${data.tool_name}...`;
    }
    // getOrCreateStepContainer handles the scroll
});

socket.on('action_step', (data) => {
    if (!isForCurrentSession(data)) return;

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
    if (!isForCurrentSession(data)) return;

    if (currentStepContainer) currentStepContainer.remove();
    const container = ensureAgentContainer();
    
    renderFinalAnswer(container, data.content);

    toggleSendButtonState(false);
    socket.emit('get_history');
});

socket.on('run_complete', (data) => { 
    if (data && data.session_id === currentSessionId) {
        toggleSendButtonState(false); 
    }
});

socket.on('error', (data) => { 
    if (isForCurrentSession(data) || !data.session_id) {
        alert(data.message); 
        toggleSendButtonState(false);
    }
});


// --- Modal Logic (Renaming/Deleting) ---

const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMsg = document.getElementById('modal-msg');
const modalInput = document.getElementById('modal-input');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
let currentModalAction = null; 
let targetSessionId = null;

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
    modalMsg.textContent = "Are you sure? This cannot be undone.";
    modalMsg.style.display = 'block';
    modalInput.style.display = 'none';
    modalConfirmBtn.textContent = "Delete";
    modalConfirmBtn.classList.add('danger');
    modalOverlay.classList.add('visible');
}

modalCancelBtn.onclick = closeModal;
modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
modalConfirmBtn.onclick = () => {
    if (!targetSessionId) return;
    if (currentModalAction === 'rename') {
        const newName = modalInput.value.trim();
        if (newName) socket.emit('rename_session', { id: targetSessionId, new_name: newName });
    } else if (currentModalAction === 'delete') {
        socket.emit('delete_session', { id: targetSessionId });
        if (targetSessionId === currentSessionId) {
            socket.emit('new_chat');
        }
    }
    closeModal();
};
modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modalConfirmBtn.click();
});