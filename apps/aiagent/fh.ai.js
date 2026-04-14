/**
 * FeHelper AI 助手 - 流式问答
 * 支持 SiliconFlow 及任意 OpenAI 兼容服务
 */

const PROVIDERS = {
    siliconflow: {
        name: 'SiliconFlow',
        url: 'https://api.siliconflow.cn/v1/chat/completions',
        model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        needsKey: true,
        signupUrl: 'https://cloud.siliconflow.cn'
    },
    custom: {
        name: '自定义 (OpenAI 兼容)',
        url: '',
        model: '',
        needsKey: true
    }
};

const SYSTEM_PROMPT = {
    role: 'system',
    content: '你是由FeHelper提供的，一个专为开发者服务的AI助手。' +
        '你的目标是精准理解开发者的技术需求，并以最简洁、直接、专业的方式输出高质量代码，并且保证代码的完整性。' +
        '请避免无关的解释和冗余描述，只输出开发者真正需要的代码和必要的技术要点说明。' +
        '遇到不明确的需求时，优先追问关键细节，绝不输出与开发无关的内容。' +
        '如果生成的是代码，一定要用```的markdown代码块包裹，并使用markdown语法渲染。'
};

let AI = (() => {

    function buildMessages(messages) {
        if (typeof messages === 'string') {
            return [SYSTEM_PROMPT, { role: 'user', content: messages }];
        }
        if (Array.isArray(messages)) {
            const has = messages.some(m => m.role === 'system');
            return has ? messages : [SYSTEM_PROMPT, ...messages];
        }
        return [SYSTEM_PROMPT];
    }

    /**
     * 从 chrome.storage.local 读取用户配置
     */
    function getConfig() {
        return new Promise(resolve => {
            chrome.storage.local.get(['fh_ai_provider', 'fh_ai_apikey', 'fh_ai_custom_url', 'fh_ai_custom_model'], data => {
                resolve({
                    provider: data.fh_ai_provider || 'siliconflow',
                    apiKey: data.fh_ai_apikey || '',
                    customUrl: data.fh_ai_custom_url || '',
                    customModel: data.fh_ai_custom_model || ''
                });
            });
        });
    }

    function saveConfig(cfg) {
        return new Promise(resolve => {
            chrome.storage.local.set({
                fh_ai_provider: cfg.provider,
                fh_ai_apikey: cfg.apiKey,
                fh_ai_custom_url: cfg.customUrl || '',
                fh_ai_custom_model: cfg.customModel || ''
            }, resolve);
        });
    }

    /**
     * 流式问答
     */
    async function askCoderLLM(messages, receivingCallback, apiKey) {
        const config = await getConfig();
        const providerKey = config.provider || 'siliconflow';
        const provider = PROVIDERS[providerKey] || PROVIDERS.siliconflow;

        const key = apiKey || config.apiKey;
        if (!key) {
            const signupUrl = provider.signupUrl || 'https://cloud.siliconflow.cn';
            throw new Error(`NO_API_KEY:${providerKey}:${signupUrl}`);
        }

        const url = providerKey === 'custom' ? (config.customUrl || provider.url) : provider.url;
        const model = providerKey === 'custom' ? (config.customModel || provider.model) : provider.model;
        const msgs = buildMessages(messages);

        const body = {
            model,
            messages: msgs,
            stream: true,
            max_tokens: 4096,
            temperature: 0.7,
            top_p: 0.7
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let done = false;
        const msg = { id: '', content: '' };

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();
                for (let line of lines) {
                    line = line.trim();
                    if (!line || !line.startsWith('data:')) continue;
                    let jsonStr = line.replace(/^data:/, '').trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        let obj = JSON.parse(jsonStr);
                        if (obj.choices?.[0]?.delta?.content) {
                            msg.id = obj.id;
                            msg.created = obj.created;
                            msg.content += obj.choices[0].delta.content;
                            receivingCallback && receivingCallback(msg);
                        }
                    } catch (e) {}
                }
            }
        }
        receivingCallback && receivingCallback(null, true);
    }

    return { askCoderLLM, getConfig, saveConfig, PROVIDERS };
})();

export default AI;
