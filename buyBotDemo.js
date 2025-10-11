require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// Config
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const VIDEO_FILE_ID = process.env.VIDEO_FILE_ID;

// Initialize
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Global ETH price (fetched once at startup)
let ETH_PRICE = 3900; // Fallback

// Fetch ETH price from CoinGecko
async function fetchETHPrice() {
    return new Promise((resolve) => {
        https.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const price = JSON.parse(data).ethereum.usd;
                    console.log(`💰 ETH Price: $${price}`);
                    resolve(price);
                } catch (e) {
                    console.log(`⚠️ Using fallback ETH price: $${ETH_PRICE}`);
                    resolve(ETH_PRICE);
                }
            });
        }).on('error', () => {
            console.log(`⚠️ Using fallback ETH price: $${ETH_PRICE}`);
            resolve(ETH_PRICE);
        });
    });
}

// Format numbers
function formatNum(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

// Format address
function formatAddr(addr) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Generate random address
function randomAddr() {
    const chars = '0123456789abcdef';
    let addr = '0x';
    for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)];
    }
    return addr;
}

// Get tier based on USD value ($20k+ = Whale)
function getTier(mmvAmount) {
    if (mmvAmount >= 2500000) return { emoji: '🤑🤑🤑🤑🤑🤑🤑', label: 'WHALE' };
    if (mmvAmount >= 1000000) return { emoji: '🤑🤑🤑🤑🤑🤑', label: 'SHARK' };
    if (mmvAmount >= 500000) return { emoji: '🤑🤑🤑🤑🤑', label: 'DOLPHIN' };
    if (mmvAmount >= 100000) return { emoji: '🤑🤑🤑🤑', label: 'FISH' };
    if (mmvAmount >= 50000) return { emoji: '🤑🤑🤑', label: 'SHRIMP' };
    if (mmvAmount >= 10000) return { emoji: '🤑🤑', label: 'PLANKTON' };
    return { emoji: '🤑', label: 'DUST' };
}

// Generate random purchase
async function simulatePurchase() {
    try {
        // Random MMV amount: 2,500 - 100,000 (more realistic)
        const baseMMV = Math.floor(Math.random() * 9750) + 2500;
        const bonus = baseMMV * 2; // 200% bonus
        const totalMMV = baseMMV + bonus;
        
        // Calculate USD (MMV price = $0.008)
        const usdAmount = baseMMV * 0.008;
        
        // Random payment method
        const methods = ['ETH', 'USDT', 'USDT'];
        const method = methods[Math.floor(Math.random() * methods.length)];
        
        // Calculate paid amount using fetched ETH price
        const paidAmount = method === 'ETH' 
            ? (usdAmount / ETH_PRICE).toFixed(4)
            : usdAmount.toFixed(2);

        const tier = getTier(totalMMV);
        const buyer = randomAddr();

        // Create message
        const message = `
${tier.emoji} <b>${tier.label} ALERT!</b>

💰 <b>${paidAmount} ${method}</b> → <b>${formatNum(totalMMV)} $MMV</b>
🎁 Bonus: +${formatNum(bonus)} MMV (200%)

👤 <code>${formatAddr(buyer)}</code>

⚡ Stage 1 won't last. Get 3X tokens NOW.
        `.trim();

        // Buttons
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🚀 Buy $MMV', url: 'https://www.metamemevault.com/' },
                    { text: '🔒 Lock $MMV', url: 'https://www.metamemevault.com/memetreasury' }
                ]
            ]
        };

        // Send as animation (plays inline)
        await bot.sendAnimation(GROUP_ID, VIDEO_FILE_ID, {
            caption: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });

        console.log(`✅ ${tier.label}: ${formatNum(totalMMV)} MMV | $${usdAmount.toFixed(2)} | ${paidAmount} ${method}`);
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// Schedule purchases: 2-3 times per hour (20-30 min intervals)
function scheduleNext() {
    const delay = Math.floor(Math.random() * 6000) + 12000; // 20-30 min
    // const delay = Math.floor(Math.random() * 600000) + 1200000; // 20-30 min
    
    setTimeout(async () => {
        await simulatePurchase();
        scheduleNext();
    }, delay);
}

// Telegram error handling
bot.on('polling_error', (error) => {
    console.error('❌ Telegram error:', error.message);
});

// Startup
(async () => {
    console.log('🤖 MMV DEMO Bot Starting...');
    console.log(`💬 Posting to: ${GROUP_ID}`);
    
    // Fetch ETH price once
    ETH_PRICE = await fetchETHPrice();
    
    console.log(`⏰ ${new Date().toLocaleString()}`);
    console.log(`🎯 Simulating 2-3 purchases per hour`);
    console.log('━'.repeat(50));
    
    // Start simulation
    scheduleNext();
    
    // Keep alive ping
    setInterval(() => {
        console.log(`💚 Bot running - ${new Date().toLocaleTimeString()}`);
    }, 1800000); // Every 30 min

})();
