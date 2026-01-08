/* src/smolagentsUI/static/app.js */
const socket = io();
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');
const variableList = document.getElementById('variable-list'); // NEW: Variable Viewer Element

// Global State
let isGenerating = false;
let currentStepContainer = null; 
let currentStreamText = "";
let currentSessionId = null; 
let agentSpecs = null; 
let streamRenderTimeout = null;

// --- Smart Scroll Logic ---
let isUserAtBottom = true; // Default to true so it scrolls initially

chatContainer.addEventListener('scroll', () => {
    const threshold = 30; // pixels from bottom to be considered "at bottom"
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

/**
 * Ensures the existence of the "Developer View" / Process Group wrapper.
 * Returns the DOM element for the group.
 */
function getOrCreateProcessGroup(container) {
    // Check if the last element is already a process group
    let group = container.querySelector('.agent-process-group:last-of-type');
    
    // Logic: If there is no group, or the last group is "closed" (e.g. by a final answer following it), create new.
    // However, typically all steps for one turn go in one group.
    if (!group) {
        group = document.createElement('div');
        group.className = 'agent-process-group';
        
        group.innerHTML = `
            <div class="process-status-panel" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="loading-bar"></div>
                <div class="status-text">Agent steps...</div>
                <div class="toggle-icon">▼</div>
            </div>
            <div class="process-steps-container"></div>
        `;
        container.appendChild(group);
    }
    return group;
}

function getOrCreateStepContainer() {
    if (!currentStepContainer) {
        const agentContent = ensureAgentContainer();
        const group = getOrCreateProcessGroup(agentContent);
        const stepsContainer = group.querySelector('.process-steps-container');

        // Ensure the group is showing the running animation
        group.classList.add('running');

        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'step-thinking';
        thinkingDiv.innerHTML = '<span class="spinner">⚡</span> Thinking...';
        
        stepsContainer.appendChild(thinkingDiv);
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
    let stepsContainer;
    
    // If we were streaming, the placeholder is inside the correct container
    if (currentStepContainer) {
        stepsContainer = currentStepContainer.parentElement;
        currentStepContainer.remove();
        currentStepContainer = null;
        currentStreamText = "";
    } else {
        // Otherwise (loading history), ensure we find/create the wrapper
        const agentContent = ensureAgentContainer();
        const group = getOrCreateProcessGroup(agentContent);
        stepsContainer = group.querySelector('.process-steps-container');
    }

    // --- Parse Model Output (String vs JSON) ---
    let thoughtText = "";
    let modelGeneratedCode = null;

    if (modelOutput) {
        if (typeof modelOutput === 'object') {
            // Handle JSON structure
            thoughtText = modelOutput.thought || "";
            if (modelOutput.code) {
                modelGeneratedCode = modelOutput.code;
            }
        } else
        try {
            // Attempt to parse as JSON
            modelOutput = JSON.parse(modelOutput);
            thoughtText = modelOutput.thought || "";
            if (modelOutput.code) {
                modelGeneratedCode = modelOutput.code;
            }
        } catch (e) {
            // Handle standard String output
            thoughtText = String(modelOutput);
        }
    }

    const details = document.createElement('details');
    details.className = 'step';
    if(error) details.classList.add('error');
    
    const summary = document.createElement('summary');
    
    // --- Generate Summary Layout ---
    const textWrapper = document.createElement('div');
    textWrapper.style.display = 'flex';
    textWrapper.style.flexDirection = 'column';
    textWrapper.style.flexGrow = '1';
    textWrapper.style.minWidth = '0'; // Essential for text-overflow to work in flex children

    const stepLabel = document.createElement('div');
    stepLabel.textContent = error ? `Step ${stepNumber} (Error)` : `Step ${stepNumber}`;
    textWrapper.appendChild(stepLabel);
    
    // Use the parsed thoughtText for the preview
    if (thoughtText) {
        // Collapse newlines to spaces for a single-line preview
        let text = thoughtText.replace(/\s+/g, ' ').trim();
        
        if (text.length > 100) {
            text = text.substring(0, 100) + "...";
        }
        
        if (text) {
            const preview = document.createElement('div');
            preview.textContent = text;
            
            // Styling for "generated by agent" look
            preview.style.fontFamily = 'Consolas, "Liberation Mono", Menlo, Courier, monospace';
            preview.style.fontSize = '0.85em';
            preview.style.color = '#a0a0a0'; 
            preview.style.marginTop = '4px';
            preview.style.whiteSpace = 'nowrap';
            preview.style.overflow = 'hidden';
            preview.style.textOverflow = 'ellipsis';
            
            textWrapper.appendChild(preview);
        }
    }
    summary.appendChild(textWrapper);

    const body = document.createElement('div');
    body.className = 'step-content';
    
    let htmlContent = "";
    
    // 1. Render Thought
    if (thoughtText) {
        const thoughtContent = thoughtText.replace(/<code>[\s\S]*?<\/code>/g, "").trim();
        if (thoughtContent) {
            htmlContent += `<div class="model-output" style="margin-bottom: 10px; border-bottom: 1px dashed #444; padding-bottom: 10px;">${marked.parse(thoughtContent)}</div>`;
        }
    }

    // 2. Render Code from Model Output (if present in JSON and different from executed code)
    if (modelGeneratedCode && (!code || modelGeneratedCode.trim() !== code.trim())) {
        const fencedModelCode = "```python\n" + modelGeneratedCode + "\n```";
        htmlContent += `<div class="code-block">${marked.parse(fencedModelCode)}</div>`;
    }

    // 3. Render Executed Code (Action)
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

    let errorText = ""
    if (error) {
        if (typeof error === 'object') {
            // Handle JSON structure: { _type: "...", message: "..." }
            errorText = error.message || "";
        } else {
            // Handle standard String output
            errorText = String(error);
        }
    }

    if (error) htmlContent += `<div class="error-msg"><strong>Error:</strong> ${errorText}</div>`;

    body.innerHTML = htmlContent;
    details.appendChild(summary);
    details.appendChild(body);
    
    stepsContainer.appendChild(details);

    details.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    // Update the status panel to reflect completion of this step (if live)
    const group = stepsContainer.parentElement;
    const statusText = group.querySelector('.status-text');
    if (statusText && isGenerating) {
        statusText.textContent = `Completed Step ${stepNumber}`;
    }
    
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
    
    renderContentRecursive(div, content);
    
    div.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    container.appendChild(div);
    scrollToBottom();
}

function renderVariables(variables) {
    if (!variables || variables.length === 0) {
        variableList.innerHTML = '<div class="empty-state">No variables active</div>';
        return;
    }

    variableList.innerHTML = '';
    
    variables.forEach(v => {
        const card = document.createElement('div');
        card.className = 'var-card';
        card.dataset.name = v.name; // Store name for reference
        
        const shapeBadge = v.shape ? `<span style="background:#333; padding:1px 4px; border-radius:3px; margin-left:6px;">${v.shape}</span>` : '';

        card.innerHTML = `
            <div class="var-header">
                <span class="var-name">${v.name}</span>
                <span class="var-type">${v.type}${shapeBadge}</span>
            </div>
            <div class="var-preview" title="${v.preview.replace(/"/g, '&quot;')}">${v.preview}</div>
        `;
        
        // --- UPDATED CLICK LOGIC ---
        card.onclick = (e) => {
            // If user clicks inside the expanded content (e.g. to copy text), don't collapse
            if (e.target.closest('.var-expanded-content')) return;

            // Toggle Collapse if already expanded
            if (card.classList.contains('expanded')) {
                card.classList.remove('expanded');
                const existingContent = card.querySelector('.var-expanded-content');
                if (existingContent) existingContent.remove();
                return;
            }

            // Visual feedback that we are fetching
            card.style.opacity = '0.6';
            card.style.cursor = 'wait';
            
            socket.emit('inspect_variable', { 
                session_id: currentSessionId, 
                name: v.name 
            });
        };
        
        variableList.appendChild(card);
    });
}

socket.on('variable_details', (data) => {
    // Reset card style
    const card = document.querySelector(`.var-card[data-name="${data.name}"]`);
    if (card) {
        card.style.opacity = '1';
        card.style.cursor = 'pointer';
    }

    if (data.error) {
        alert(data.error);
        return;
    }

    // Logic: DataFrame/Image -> Modal, Others -> Expand Card
    if (data.type === 'dataframe' || data.type === 'image') {
        openInspectionModal(data);
    } else {
        if (card) expandVariableCard(card, data.content);
    }
});

function expandVariableCard(card, content) {
    card.classList.add('expanded');
    
    const container = document.createElement('div');
    container.className = 'var-expanded-content';
    
    // Use Pre tag for code/text formatting
    const pre = document.createElement('pre');
    pre.textContent = content;
    
    container.appendChild(pre);
    card.appendChild(container);
}

function openInspectionModal(data) {
    // Reuse existing modal structure or create a custom viewer overlay
    // We will create a specific "Inspector Overlay" dynamically to keep it clean
    
    let overlay = document.getElementById('inspector-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'inspector-overlay';
        overlay.className = 'modal-overlay visible'; // Reuse visible class from style.css
        document.body.appendChild(overlay);
        
        // Close on background click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        };
    }

    // Content Container
    const contentBox = document.createElement('div');
    contentBox.className = 'inspector-box';
    
    // Header
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `
        <span class="title">${data.name} <span class="type-tag">(${data.type})</span></span>
        <button class="close-btn" onclick="document.getElementById('inspector-overlay').remove()">×</button>
    `;

    // Body
    const body = document.createElement('div');
    body.className = 'inspector-body';

    if (data.type === 'image') {
        const img = document.createElement('img');
        img.src = data.content;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.objectFit = 'contain';
        body.style.display = 'flex';
        body.style.justifyContent = 'center';
        body.style.alignItems = 'center';
        body.appendChild(img);
    } else if (data.type === 'dataframe') {
        // Inject the HTML Table
        body.innerHTML = data.content;
    }

    contentBox.appendChild(header);
    contentBox.appendChild(body);
    overlay.appendChild(contentBox);
}

// New Sidebar Toggle Logic
function toggleRightSidebar() {
    const sidebar = document.getElementById('right-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}
// Expose globally
window.toggleRightSidebar = toggleRightSidebar;

// NEW: Event Listener for sidebar toggle
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleRightSidebar);
}


// --- User Actions ---

sendBtn.addEventListener('click', () => {
    // STOP ACTION
    if (isGenerating) {
        socket.emit('stop_run', { session_id: currentSessionId });

        if (currentStepContainer) {
            currentStepContainer.classList.remove('step-thinking');
            currentStepContainer.innerHTML = currentStreamText + '\n\n[Stopping...]'; 
        }
        
        toggleSendButtonState(false); 
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
    getOrCreateStepContainer();
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
    
    if (variableList) {
        variableList.innerHTML = '<div class="empty-state">No variables active</div>';
    }
    
    if (data.id) currentSessionId = data.id;
    else currentSessionId = null; 

    toggleSendButtonState(false);

    // Case 1: New/Empty Chat
    if (!data.steps || data.steps.length === 0) {
        renderWelcomeScreen();
        return;
    }
    
    // Case 2: Restore History
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
    
    scrollToBottom(true);
});


// --- Socket Events (Streaming & Logic) ---

function isForCurrentSession(data) {
    return data.session_id === currentSessionId;
}

/* Helper to unescape JSON string content manually */
function unescapeJson(str) {
    return str.replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
              .replace(/\\t/g, '\t');
}

/* Helper to parse partial stream */
function parseStream(text) {
    // 1. JSON Mode (use_structured_outputs_internally=True)
    if (text.trim().startsWith('{')) {
        const thoughtMatch = text.match(/"thought"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/);
        const codeMatch = text.match(/"code"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/);
        
        return {
            mode: 'json',
            thought: thoughtMatch ? unescapeJson(thoughtMatch[1]) : "",
            code: codeMatch ? unescapeJson(codeMatch[1]) : ""
        };
    }
    
    // 2. Text/Tag Mode (Standard smolagents)
    // Pattern: text... <code>code...
    const codeStart = text.indexOf('<code>');
    if (codeStart !== -1) {
        let thought = text.substring(0, codeStart);
        let code = text.substring(codeStart + 6); // 6 is len of <code>
        
        // Remove closing tag if present
        const codeEnd = code.lastIndexOf('</code>');
        if (codeEnd !== -1) {
            code = code.substring(0, codeEnd);
        }
        return { mode: 'text', thought: thought, code: code };
    }

    // 3. Plain Text
    return { mode: 'text', thought: text, code: null };
}

/**
 * Renders the current buffered stream text to the UI.
 */
function renderCurrentStream() {
    // This creates/finds the 'thinking' element AND makes sure the developer view wrapper exists
    const div = getOrCreateStepContainer();
    
    const parsed = parseStream(currentStreamText);
    
    let html = "";
    if (parsed.thought) {
        // Render thought (Markdown supported)
        html += `<div class="model-thought" style="margin-bottom: 10px;">${marked.parse(parsed.thought)}</div>`;
    }
    if (parsed.code) {
        // Render code block
        html += `<div class="code-block"><pre><code class="language-python">${parsed.code}</code></pre></div>`;
    }
    
    if (html) {
        div.innerHTML = html;
        // Highlight code blocks
        div.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    } else {
        // Fallback if empty
        div.textContent = currentStreamText;
    }
    
    // Update the Status Panel Text with the first line of thought
    const group = div.closest('.agent-process-group');
    if (group) {
        const statusText = group.querySelector('.status-text');
        if (statusText) {
            // Use parsed thought for cleaner status (avoids JSON syntax)
            const sourceText = parsed.thought || currentStreamText;
            
            // Find first non-empty line
            const match = sourceText.match(/\S.*$/m); 
            if (match) {
                 const line = match[0];
                 statusText.textContent = line.length > 80 ? line.substring(0, 80) + "..." : line;
            } else if (sourceText.length > 0) {
                 statusText.textContent = "Thinking..."; 
            }
        }
    }

    scrollToBottom();
    streamRenderTimeout = null; // Clear the timeout flag
}

socket.on('stream_delta', (data) => {
    if (!isForCurrentSession(data)) return;
    
    currentStreamText += data.content;

    if (!streamRenderTimeout) {
        streamRenderTimeout = setTimeout(renderCurrentStream, 50); // 50ms = 20fps
    }
});

socket.on('tool_start', (data) => {
    if (!isForCurrentSession(data)) return;

    const div = getOrCreateStepContainer();
    if (currentStreamText.length < 50) {
        const text = `Calling ${data.tool_name}...`;
        div.innerHTML = `<span class="spinner">⚙️</span> ${text}`;
        
        // Also update the panel status
        const group = div.closest('.agent-process-group');
        if(group) {
            const statusText = group.querySelector('.status-text');
            if(statusText) statusText.textContent = text;
        }
    }
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

// NEW: Listen for Variable Updates
socket.on('variable_state', (data) => {
    if (data.session_id !== currentSessionId) return;
    renderVariables(data.variables);
});

socket.on('final_answer', (data) => {
    if (!isForCurrentSession(data)) return;

    if (currentStepContainer) currentStepContainer.remove();
    const container = ensureAgentContainer();
    
    // Stop the running animation on the process group
    const group = container.querySelector('.agent-process-group:last-of-type');
    if (group) {
        group.classList.remove('running');
        const statusText = group.querySelector('.status-text');
        if(statusText) statusText.textContent = "Task Completed";
    }

    renderFinalAnswer(container, data.content);

    toggleSendButtonState(false);
    socket.emit('get_history');
});

socket.on('run_complete', (data) => { 
    if (data && data.session_id === currentSessionId) {
        toggleSendButtonState(false); 

        let lastMsg = chatContainer.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('agent')) {
            const container = lastMsg.querySelector('.content');
            if (container) {
                // Find and stop the running animation on the process group
                const group = container.querySelector('.agent-process-group:last-of-type');
                if (group) {
                    group.classList.remove('running');
                    const statusText = group.querySelector('.status-text');
                    
                    // Update status text, unless final_answer already set it to "Task Completed"
                    if(statusText && statusText.textContent !== "Task Completed") {
                        statusText.textContent = "Run Ended"; 
                    }
                }
            }
        }
        // ------------------------------------------------------------
        
        if (currentStepContainer) {
            currentStepContainer.remove(); 
        }
        currentStepContainer = null;
        currentStreamText = "";
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

// --- Expand/Collapse Input Logic ---

const expandBtn = document.getElementById('expand-btn');
const inputWrapper = document.querySelector('.input-wrapper');

if (expandBtn && inputWrapper) {
    expandBtn.addEventListener('click', () => {
        inputWrapper.classList.toggle('expanded');
        const isExpanded = inputWrapper.classList.contains('expanded');
        
        if (isExpanded) {
            // Switch to "Minimize" icon
            expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`;
            expandBtn.title = "Collapse input";
        } else {
            // Switch back to "Expand" icon
            expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
            expandBtn.title = "Expand input";
        }
    });
}