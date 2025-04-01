// 📦 Required Packages
const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

// 🔐 Environment Variables
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_ID;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// 🧠 Luna Proxy Config
function generateSessionProxy(username) {
    const session = `session-${Math.floor(Math.random() * 100000)}`;
    return `http://user-lu4755006-${session}:onePiece2023$@pr.t7ghinxv.lunaproxy.net:12233`;
}

// 🌐 IP Check
async function getCurrentIP(agent, username) {
    try {
        const res = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: agent,
            proxy: false,
            timeout: 8000,
        });
        console.log(`🌐 ${username} is using IP: ${res.data.ip}`);
    } catch (error) {
        console.error(`❌ Failed to fetch IP for ${username}:`, error.message);
    }
}

// 🤖 Initialize Bots and API Clients
const bot = new TelegramBot(telegramToken, { polling: true });
const openai = new OpenAI({ apiKey: openaiApiKey });

// 🧾 Load Tokens and Setup OAuth2 Clients with Proxies
const tokenFiles = fs.readdirSync('tokens').filter(file => file.endsWith('.json'));

const users = tokenFiles.map(file => {
    const credentials = JSON.parse(fs.readFileSync(`tokens/${file}`));
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.setCredentials(credentials);

    const proxyUrl = generateSessionProxy(file.replace('.json', ''));
    const agent = new HttpsProxyAgent(proxyUrl);

    getCurrentIP(agent, file.replace('.json', ''));

    oauth2Client.transporter = {
        request: (opts) => {
            const client = axios.create({
                httpsAgent: agent,
                proxy: false,
            });
            return client.request({
                url: opts.url,
                method: opts.method,
                headers: opts.headers,
                data: opts.data,
                params: opts.params,
                responseType: 'json',
            });
        }
    };

    console.log(`✅ Loaded credentials for ${file.replace('.json', '')} with proxy`);
    return { username: file.replace('.json', ''), auth: oauth2Client, credentials, agent };
});

if (users.length === 0) {
    console.error("❌ No authenticated Google accounts found! Run get_token.js to add accounts.");
    process.exit(1);
}

const youtubeClients = users.map(user => ({
    username: user.username,
    auth: user.auth,
    youtube: google.youtube({
        version: 'v3',
        auth: user.auth,
    })
}));

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function refreshAccessToken(user) {
    try {
        if (!user.auth.credentials || !user.auth.credentials.refresh_token) {
            console.error(`❌ No refresh token found for ${user.username}. Re-authenticating...`);
            return;
        }

        console.log(`🔄 Refreshing access token for ${user.username}...`);
        const { credentials } = await user.auth.refreshAccessToken();
        user.auth.setCredentials(credentials);
        credentials.refresh_token = user.auth.credentials.refresh_token;
        fs.writeFileSync(`tokens/${user.username}.json`, JSON.stringify(credentials, null, 2));
        console.log(`🔄 Refreshed access token for ${user.username}`);
    } catch (error) {
        console.error(`❌ Error refreshing token for ${user.username}:`, error.message);
    }
}

async function getCommentsOrMetadata(videoId, youtube) {
    try {
        const res = await youtube.commentThreads.list({ part: 'snippet', videoId, maxResults: 50 });
        const comments = res.data.items?.map(item => item.snippet.topLevelComment.snippet.textOriginal) || [];
        if (comments.length > 0) return { type: 'comments', data: comments };

        const videoRes = await youtube.videos.list({ part: 'snippet', id: videoId });
        const video = videoRes.data.items?.[0]?.snippet;
        const combined = `${video.title || ''}\n\n${video.description || ''}`.trim();
        return { type: 'metadata', data: combined || 'a YouTube video' };
    } catch (error) {
        console.error('❌ Error fetching video data:', error.message);
        return { type: 'fallback', data: 'a YouTube video' };
    }
}

// 🔠 Random Font Function
function randomFont(char) {
    const fonts = [
        { offset: 0x1D400 - 65, onlyCaps: true },
        { offset: 0x1D41A - 97, onlyCaps: false },
        { offset: 0x1D434 - 65, onlyCaps: true },
        { offset: 0x1D44E - 97, onlyCaps: false },
        { offset: 0x1D468 - 65, onlyCaps: true },
        { offset: 0x1D482 - 97, onlyCaps: false },
    ];
    const set = fonts[Math.floor(Math.random() * fonts.length)];
    const code = char.charCodeAt(0);
    if (/[A-Za-z]/.test(char)) {
        if (/[A-Z]/.test(char) && set.onlyCaps) return String.fromCodePoint(set.offset + (code - 65));
        if (/[a-z]/.test(char) && !set.onlyCaps) return String.fromCodePoint(set.offset + (code - 97));
    }
    return char;
}

function obfuscateKeyword(text, keyword) {
    const zeroWidth = '​';
    const randomChars = ['$', '#', '@', '%', '&', '*', '!', '^', '~'];
    const chars = keyword.split('');
    const obfuscated = chars
        .map((char, i) => {
            const shouldObfuscate = Math.random() < 0.25;
            if (!shouldObfuscate) return char;
            const styled = randomFont(char);
            const randomChar = Math.random() < 0.5 ? zeroWidth : randomChars[Math.floor(Math.random() * randomChars.length)];
            return `${styled}${randomChar}`;
        })
        .join(' ');
    const bolded = `**${obfuscated}**`;
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    return text.replace(regex, bolded);
}

function injectRandomEmojis(text, niche = 'gambling') {
    const emojiSets = {
        default: ['🔥', '🚀', '💯', '🎯', '✨', '📈', '🤖', '🧠', '💥', '🎲'],
        gambling: ['🎰', '💸', '🍀', '💰', '🤑', '🎲', '🃏', '🎯'],
        crypto: ['🪙', '📉', '📈', '🚀', '💰', '🔐', '🤖'],
    };
    const emojis = emojiSets[niche] || emojiSets.default;
    return text
        .split(' ')
        .map(word => (Math.random() < 0.25 ? `${word} ${emojis[Math.floor(Math.random() * emojis.length)]}` : word))
        .join(' ');
}

function randomizeStyle(reply) {
    const styles = [
        (r) => r,
        (r) => `"${r}" 👀`,
        (r) => `🔥 ${r}`,
        (r) => `${r} 😂💯`,
        (r) => `${r.split(' ').map(w => w.toUpperCase()).join(' ')} 💥`,
        (r) => `${r} 🤔 what do y'all think?`,
    ];
    return styles[Math.floor(Math.random() * styles.length)](reply);
}

async function generateReply(input, sourceType) {
    try {
        const keywords = ['GOLD888', 'POLASLOT88', 'WINGS365'];
        const chosenKeyword = keywords[Math.floor(Math.random() * keywords.length)];
        const prompt = sourceType === 'comments'
            ? `Respond casually and naturally to this YouTube comment like a real viewer. Make it one sentence, avoid generic phrases like "thanks" or "great video", and include ONLY this keyword: ${chosenKeyword}. Here's the comment: "${input}"`
            : `Write a short, natural-sounding one-sentence YouTube comment about this video. Avoid generic praise. Make it feel like a real viewer reaction, and include ONLY this keyword: ${chosenKeyword}. Here's the video info: "${input}"`;
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
        });
        let reply = response.choices[0]?.message?.content?.trim();
        if (!reply || reply.length < 3) reply = `This part really hit different. #${chosenKeyword}`;
        reply = obfuscateKeyword(reply, chosenKeyword);
        reply = injectRandomEmojis(reply, 'gambling');
        reply = randomizeStyle(reply);
        return reply;
    } catch (error) {
        console.error('❌ Error generating AI response:', error.message);
        return injectRandomEmojis(obfuscateKeyword(`Kinda vibing with this one. #gold888`, 'gold888'), 'gambling');
    }
}

// 🔥 POST TOP-LEVEL COMMENT ONLY
async function postComment(videoId, source, chatId) {
    const successUsers = [];
    const failedUsers = [];
    for (let i = 0; i < youtubeClients.length; i++) {
        const user = youtubeClients[i];
        try {
            if (!user.auth?.credentials?.access_token) {
                console.error(`❌ No valid credentials for ${user.username}. Skipping...`);
                failedUsers.push(user.username);
                continue;
            }
            await refreshAccessToken(user);
            const input = source.type === 'comments' ? source.data[Math.floor(Math.random() * source.data.length)] : source.data;
            const reply = await generateReply(input, source.type);

            await user.youtube.commentThreads.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        videoId,
                        topLevelComment: {
                            snippet: {
                                textOriginal: reply,
                            },
                        },
                    },
                },
            });
            console.log(`✅ Posted top-level comment by ${user.username}: "${reply}"`);

            console.log(chatId, `✅ ${user.username} finished commenting. Waiting 10 seconds...`);
            successUsers.push(user.username);
            if (i < youtubeClients.length - 1) {
                await delay(10000);
                console.log(chatId, `⌛ Loading next user...`);
            }
        } catch (error) {
            console.error(`❌ Error posting comment for ${user.username}:`, error.message);
            console.log(chatId, `⚠️ Failed to post comment for ${user.username}`);
            failedUsers.push(user.username);
        }
    }
    let summaryMessage = `🏁 All users finished posting comments!\n\n`;
    if (successUsers.length > 0) summaryMessage += `✅ *Successful*: ${successUsers.map(u => `\`${u}\``).join(', ')}\n`;
    if (failedUsers.length > 0) summaryMessage += `⚠️ *Failed*: ${failedUsers.map(u => `\`${u}\``).join(', ')}`;
    await bot.sendMessage(chatId, summaryMessage.trim(), { parse_mode: 'Markdown' });
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption;
    if (!text) return;
    const youtubeLink = text.match(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/);
    if (!youtubeLink) return;
    const videoId = extractVideoId(youtubeLink[0]);
    if (!videoId) {
        bot.sendMessage(chatId, '❌ Invalid YouTube link. Please try again.');
        return;
    }
    bot.sendMessage(chatId, '🔍 Analyzing the video...');
    const source = await getCommentsOrMetadata(videoId, youtubeClients[0].youtube);
    await postComment(videoId, source, chatId);
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🤖 Welcome! Send me a YouTube link (normal or Shorts), and I’ll post a comment using all available accounts.');
});

const postedVideoIds = new Set();

async function getTrendingVideosInIndonesia(youtube, maxResults = 100) {
    try {
        const response = await youtube.videos.list({
            part: 'snippet',
            chart: 'mostPopular',
            regionCode: 'ID',
            maxResults,
        });
        return response.data.items.map(video => ({ id: video.id, title: video.snippet.title, url: `https://www.youtube.com/watch?v=${video.id}` }));
    } catch (error) {
        console.error('❌ Error fetching trending videos:', error.message);
        return [];
    }
}

async function fetchAndPostTrending(bot, youtube, chatId, maxResults = 100) {
    const videos = await getTrendingVideosInIndonesia(youtube, maxResults);
    const newVideos = videos.filter(video => !postedVideoIds.has(video.id));
    if (newVideos.length === 0) {
        bot.sendMessage(chatId, '📭 No new trending videos found right now.');
        return;
    }
    newVideos.forEach(video => postedVideoIds.add(video.id));
    let message = "🔥 *Trending YouTube Videos in Indonesia:*\n\n";
    newVideos.forEach((vid, i) => {
        message += `${i + 1}. [${vid.title}](${vid.url})\n`;
    });
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

bot.onText(/\/viral/, async (msg) => {
    const chatId = msg.chat.id;
    await fetchAndPostTrending(bot, youtubeClients[0].youtube, chatId);
});

console.log('🤖 Bot is running...');
