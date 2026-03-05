export default async function handler(req,res){

const section=req.query?.section || "all"

/* helper */

const pick=(arr,n)=>{
const a=[...arr]
const out=[]
while(a.length && out.length<n){
const i=Math.floor(Math.random()*a.length)
out.push(a.splice(i,1)[0])
}
return out
}

/* -------- Pakistan News -------- */

async function pakNews(){

try{

const r=await fetch("https://newsapi.org/v2/top-headlines?country=pk&pageSize=10&apiKey=demo")
const j=await r.json()

if(j.articles){

const items=j.articles.map(a=>({
title:a.title,
url:a.url,
source:a.source?.name || "Pakistan News"
}))

return pick(items,2)

}

}catch{}

return[
{title:"Pakistan economic policy reforms announced",url:"",source:"Pakistan"},
{title:"Cricket team prepares for next international series",url:"",source:"Pakistan"}
]

}

/* -------- World News -------- */

async function worldNews(){

try{

const r=await fetch("https://hnrss.org/frontpage.jsonfeed")
const j=await r.json()

const items=j.items.map(a=>({
title:a.title,
url:a.url,
source:"World"
}))

return pick(items,1)

}catch{}

return[
{title:"Global AI investments surge across industries",url:"",source:"World"}
]

}

/* -------- Do You Know -------- */

async function doy(){

try{

const r=await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en")
const j=await r.json()

return[
{text:j.text,meta:"Did you know"},
{text:"Octopus have three hearts.",meta:"Science"},
{text:"Honey never spoils.",meta:"Fact"}
]

}catch{

return[
{text:"Sharks existed before trees.",meta:"Fact"},
{text:"A day on Venus is longer than its year.",meta:"Space"},
{text:"Your brain uses about 20% of your energy.",meta:"Human body"}
]

}

}

/* -------- Islamic -------- */

function islam(){

const pool=[
{text:"Give charity even if it is small.",meta:"Hadith"},
{text:"The best among you are those with best manners.",meta:"Hadith"},
{text:"Allah loves those who are patient.",meta:"Quran"},
{text:"Smiling at your brother is charity.",meta:"Hadith"}
]

return pick(pool,3)

}

/* -------- Quiz -------- */

function quiz(){

const pool=[
{question:"2 + 2 × 2 ?",answer:"6"},
{question:"What planet is called the Red Planet?",answer:"Mars"},
{question:"Gas plants absorb?",answer:"Carbon dioxide"},
{question:"How many continents?",answer:"7"}
]

return pick(pool,3)

}

/* -------- Innovations -------- */

async function innov(){

try{

const r=await fetch("https://api.spaceflightnewsapi.net/v4/articles/?limit=15")
const j=await r.json()

const items=j.results.map(a=>({
title:a.title,
url:a.url,
source:"Innovation"
}))

return pick(items,3)

}catch{

return[
{title:"AI tools transforming business automation",url:"",source:"Tech"},
{title:"Battery tech improving EV range",url:"",source:"Energy"},
{title:"Reusable rockets reducing launch costs",url:"",source:"Space"}
]

}

}

/* -------- Weekend -------- */

function weekend(){

const pool=[
{text:"Visit Shalimar Gardens"},
{text:"Watch a Netflix movie"},
{text:"Go jogging in park"},
{text:"Visit local café"},
{text:"Bike ride in city"}
]

return pick(pool,3)

}

/* -------- Business -------- */

function biz(){

const pool=[
{text:"Build a niche AI automation SaaS"},
{text:"Start a digital newsletter"},
{text:"Launch a micro SaaS tool"},
{text:"Start an online niche store"}
]

return pick(pool,3)

}

/* -------- Jokes -------- */

async function jokes(){

try{

const r=await fetch("https://official-joke-api.appspot.com/random_ten")
const j=await r.json()

return pick(j.map(a=>({text:`${a.setup} — ${a.punchline}`})),3)

}catch{

return[
{text:"Why don't programmers like nature? Too many bugs."},
{text:"Why do Java devs wear glasses? Because they don't C#."},
{text:"My computer said it needed a break… so it froze."}
]

}

}

/* -------- Build response -------- */

const news=[
...(await pakNews()),
...(await worldNews())
]

const result={
news,
doy:await doy(),
islam:islam(),
quiz:quiz(),
innov:await innov(),
weekend:weekend(),
biz:biz(),
jokes:await jokes()
}

if(section!=="all"){
return res.json({items:result[section] || []})
}

res.json(result)

}
