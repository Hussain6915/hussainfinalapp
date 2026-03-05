export default async function handler(req, res) {

const section=req.query?.section || "all"

/* ---------- helpers ---------- */

const clean=t=>String(t||"").replace(/\s+/g," ").trim()

const shuffle=a=>{
const arr=[...a]
for(let i=arr.length-1;i>0;i--){
const j=Math.floor(Math.random()*(i+1))
;[arr[i],arr[j]]=[arr[j],arr[i]]
}
return arr
}

const pick=(arr,n)=>shuffle(arr).slice(0,n)

/* ---------- RSS parser ---------- */

function parseRSS(xml,source){

const items=[]
const matches=xml.match(/<item>(.*?)<\/item>/gs)||[]

for(const m of matches){

const title=(m.match(/<title>(.*?)<\/title>/)||[])[1]
const link=(m.match(/<link>(.*?)<\/link>/)||[])[1]

if(title)
items.push({
title:clean(title),
url:link,
source
})

}

return items
}

async function fetchRSS(url,source){

try{

const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}})
const xml=await r.text()

return parseRSS(xml,source)

}catch{
return[]
}

}

/* ---------- NEWS ---------- */

async function buildNews(){

let pool=[]

pool.push(...await fetchRSS("https://feeds.bbci.co.uk/news/world/rss.xml","BBC"))
pool.push(...await fetchRSS("http://rss.cnn.com/rss/edition_world.rss","CNN"))
pool.push(...await fetchRSS("https://feeds.reuters.com/reuters/topNews","Reuters"))
pool.push(...await fetchRSS("https://www.aljazeera.com/xml/rss/all.xml","AlJazeera"))

/* Pakistan */

pool.push(...await fetchRSS("https://www.dawn.com/feeds/home","Dawn"))
pool.push(...await fetchRSS("https://tribune.com.pk/feed","Tribune"))
pool.push(...await fetchRSS("https://www.thenews.com.pk/rss/1/10","TheNews"))
pool.push(...await fetchRSS("https://www.geo.tv/rss/1/53","Geo"))
pool.push(...await fetchRSS("https://arynews.tv/feed/","ARY"))
pool.push(...await fetchRSS("https://humnews.pk/feed/","Hum"))

try{
const r=await fetch("https://www.reddit.com/r/worldnews/top.json?limit=40")
const j=await r.json()

pool.push(...j.data.children.map(p=>({
title:p.data.title,
url:"https://reddit.com"+p.data.permalink,
source:"Reddit"
})))
}catch{}

pool=pool.filter(x=>x.title)

return pick(pool,3)

}

/* ---------- FACTS ---------- */

async function buildFacts(){

let pool=[]

for(let i=0;i<5;i++){

try{
const r=await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en")
const j=await r.json()

pool.push({text:j.text})
}catch{}

}

for(let i=0;i<5;i++){

try{
const r=await fetch("http://numbersapi.com/random/trivia?json")
const j=await r.json()

pool.push({text:j.text})
}catch{}

}

try{
const r=await fetch("https://catfact.ninja/fact")
const j=await r.json()

pool.push({text:j.fact})
}catch{}

return pick(pool,3)

}

/* ---------- INNOVATIONS ---------- */

async function buildInnov(){

let pool=[]

pool.push(...await fetchRSS("https://techcrunch.com/feed/","TechCrunch"))
pool.push(...await fetchRSS("https://www.theverge.com/rss/index.xml","Verge"))
pool.push(...await fetchRSS("https://www.wired.com/feed/rss","Wired"))
pool.push(...await fetchRSS("https://www.technologyreview.com/feed/","MIT"))

try{
const r=await fetch("https://api.spaceflightnewsapi.net/v4/articles/?limit=40")
const j=await r.json()

pool.push(...j.results.map(a=>({
title:a.title,
url:a.url,
source:"Space"
})))
}catch{}

return pick(pool,3)

}

/* ---------- ISLAM ---------- */

function islam(){

const pool=[
"Smile — it is charity",
"Give charity even if small",
"Speak good or remain silent",
"Feed the hungry",
"Respect parents",
"Be patient in hardship",
"Remove harm from the road",
"Help someone quietly",
"Allah loves those who are patient",
"Make intention pure for Allah"
]

return pick(pool.map(t=>({text:t})),3)

}

/* ---------- BUSINESS ---------- */

function biz(){

const pool=[
"Build a micro-SaaS product",
"Create AI automation agency",
"Start niche ecommerce brand",
"Build digital templates marketplace",
"Create job alert newsletter",
"Start remote tutoring platform",
"Launch productivity mobile app",
"Create online design marketplace",
"Start local delivery startup",
"Create community learning platform"
]

return pick(pool.map(t=>({text:t})),3)

}

/* ---------- WEEKEND ---------- */

function weekend(){

const pool=[
"Visit Shalimar Gardens",
"Go jogging in park",
"Bike ride around city",
"Watch a Netflix movie",
"Photography walk",
"Try new cafe",
"Cricket with friends",
"Read a book outside",
"Visit museum or historic site",
"Cook something new"
]

return pick(pool.map(t=>({text:t})),3)

}

/* ---------- JOKES ---------- */

async function jokes(){

let pool=[]

try{
const r=await fetch("https://official-joke-api.appspot.com/random_ten")
const j=await r.json()

pool.push(...j.map(a=>({text:a.setup+" — "+a.punchline})))
}catch{}

const urdu=[
"امی: موبائل چھوڑ دو — میں: بس آخری scroll 😭",
"دوست: پیسے ہیں؟ — میں: memories ہیں 😅",
"میں: diet شروع — سامنے: سموسے",
"Netflix: کیا آپ اب بھی دیکھ رہے ہیں؟ — میں: ہاں 😭",
"ابا: بل کم کیوں نہیں — میں: بجلی کم آتی ہے 😭"
]

pool.push(...urdu.map(t=>({text:t})))

return pick(pool,3)

}

/* ---------- RESULT ---------- */

const result={
news:await buildNews(),
doy:await buildFacts(),
islam:islam(),
quiz:[],
innov:await buildInnov(),
weekend:weekend(),
biz:biz(),
jokes:await jokes()
}

if(section!=="all")
return res.json({items:result[section]||[]})

res.json(result)

}
