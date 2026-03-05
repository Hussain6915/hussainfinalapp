export default async function handler(req, res) {

const section = req.query?.section || "all"
const seed = String(req.query?.seed || Date.now())

/* ---------------- RNG ---------------- */

function makeRng(seedStr){
let h=2166136261
for(let i=0;i<seedStr.length;i++){
h^=seedStr.charCodeAt(i)
h=Math.imul(h,16777619)
}
return function(){
h+=0x6D2B79F5
let t=Math.imul(h^(h>>>15),1|h)
t^=t+Math.imul(t^(t>>>7),61|t)
return((t^(t>>>14))>>>0)/4294967296
}
}

const rand=makeRng(seed)

/* ---------------- Helpers ---------------- */

const pick=(arr,n)=>{
const a=[...arr]
const out=[]
while(a.length && out.length<n){
const i=Math.floor(rand()*a.length)
out.push(a.splice(i,1)[0])
}
return out
}

const clean=t=>String(t||"").replace(/\s+/g," ").trim()

/* ---------------- News ---------------- */

async function buildNews(){
try{

const r=await fetch("https://hnrss.org/frontpage.jsonfeed")
const j=await r.json()

const items=j.items.map(i=>({
title:clean(i.title),
url:i.url,
source:"Hacker News"
}))

return pick(items,3)

}catch{}

return[
{title:"AI startups continue raising billions globally",url:"",source:"Tech"},
{title:"Space agencies planning new moon missions",url:"",source:"Science"},
{title:"EV adoption rising across Europe and Asia",url:"",source:"Business"}
]
}

/* ---------------- Do You Know ---------------- */

async function buildDoy(){

const results=[]
const seen=new Set()

for(let i=0;i<6;i++){

try{

const r=await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en")
const j=await r.json()

const txt=clean(j.text)
if(!seen.has(txt)){
seen.add(txt)
results.push({text:txt,meta:"Did you know"})
}

}catch{}

if(results.length>=3)break
}

while(results.length<3){

const fallback=[
"Honey never spoils.",
"A day on Venus is longer than its year.",
"Octopus have three hearts.",
"Sharks existed before trees.",
"Bananas are radioactive due to potassium."
]

const txt=fallback[Math.floor(rand()*fallback.length)]
if(!seen.has(txt)){
seen.add(txt)
results.push({text:txt,meta:"Did you know"})
}

}

return results
}

/* ---------------- Islamic ---------------- */

function buildIslam(){

const pool=[
{ text:"Give charity even if it is small.", meta:"Hadith" },
{ text:"The best among you are those who have the best manners.", meta:"Prophet ﷺ" },
{ text:"Allah loves those who are patient.", meta:"Quran" },
{ text:"Feed the hungry and spread peace.", meta:"Hadith" },
{ text:"Speak good or remain silent.", meta:"Hadith" },
{ text:"Smiling at your brother is charity.", meta:"Hadith" }
]

return pick(pool,3)

}

/* ---------------- Quiz ---------------- */

function buildQuiz(){

const pool=[
{question:"What planet is known as the Red Planet?",answer:"Mars"},
{question:"2 + 2 × 2 = ?",answer:"6"},
{question:"What gas do plants absorb?",answer:"Carbon dioxide"},
{question:"How many continents are there?",answer:"7"},
{question:"Who developed relativity?",answer:"Einstein"},
{question:"What is H2O?",answer:"Water"}
]

return pick(pool,3)

}

/* ---------------- Innovations ---------------- */

async function buildInnov(){

try{

const r=await fetch("https://api.spaceflightnewsapi.net/v4/articles/?limit=20")
const j=await r.json()

const list=j.results.map(a=>({
title:clean(a.title),
url:a.url,
source:"Spaceflight News"
}))

return pick(list,3)

}catch{}

return[
{title:"Reusable rockets continue reducing launch costs",url:"",source:"Space"},
{title:"AI chips becoming dramatically faster each year",url:"",source:"AI"},
{title:"Solid state batteries promise longer EV range",url:"",source:"Energy"}
]

}

/* ---------------- Weekend ---------------- */

function buildWeekend(){

const pool=[
{ text:"Go jogging in a nearby park." },
{ text:"Watch a new Netflix movie." },
{ text:"Visit Shalimar Gardens." },
{ text:"Try a new coffee shop." },
{ text:"Read a book at a quiet café." },
{ text:"Go for a bike ride." }
]

return pick(pool,3)

}

/* ---------------- Business ---------------- */

function buildBiz(){

const pool=[
{ text:"Start a niche AI automation service." },
{ text:"Launch a small SaaS tool solving one problem." },
{ text:"Create a digital product marketplace." },
{ text:"Build a local delivery micro-service." },
{ text:"Start a newsletter monetized with sponsors." }
]

return pick(pool,3)

}

/* ---------------- Jokes ---------------- */

async function buildJokes(){

try{

const r=await fetch("https://official-joke-api.appspot.com/random_ten")
const j=await r.json()

const jokes=j.map(a=>({
text:`${a.setup} — ${a.punchline}`
}))

return pick(jokes,3)

}catch{}

return[
{ text:"Why don't programmers like nature? Too many bugs." },
{ text:"I told my computer I needed a break, it said no problem — it froze." },
{ text:"Why do Java developers wear glasses? Because they don't C#." }
]

}

/* ---------------- Build Response ---------------- */

if(section==="news"){
return res.json({items:await buildNews()})
}

if(section==="doy"){
return res.json({items:await buildDoy()})
}

if(section==="innov"){
return res.json({items:await buildInnov()})
}

const result={
news:await buildNews(),
doy:await buildDoy(),
islam:buildIslam(),
quiz:buildQuiz(),
innov:await buildInnov(),
weekend:buildWeekend(),
biz:buildBiz(),
jokes:await buildJokes()
}

res.json(result)

}
