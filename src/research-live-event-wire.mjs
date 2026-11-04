import crypto from 'node:crypto';

const MAX_BYTES=1024*1024,MAX_DEPTH=64,MAX_NODES=100_000;
const invalid=()=>{throw new Error('research_live_event_wire_invalid');};

// Compare decimal values without rounding through Number. Whole-number floats,
// exponent spelling and -0 are compatible; excess precision must not round an
// off-tick price or fractional volume into an apparently valid integer.
function decimal(value){
  const [coefficient,exponent='0']=value.toLowerCase().split('e');
  const negative=coefficient.startsWith('-'),unsigned=negative?coefficient.slice(1):coefficient;
  const [integer,fraction='']=unsigned.split('.');
  const digits=(integer+fraction).replace(/^0+/,'');
  if(!digits)return '0';
  const significant=digits.replace(/0+$/,'');
  return `${negative?'-':''}${significant}e${Number(exponent)-fraction.length+digits.length-significant.length}`;
}

function parseStrict(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_BYTES)invalid();
  let at=0,nodes=0;
  const whitespace=()=>{while(at<text.length&&/[\t\n\r ]/.test(text[at]))at++;};
  function string(){
    if(text[at]!=='"')invalid();
    const start=at++;
    while(at<text.length){
      const char=text[at++];
      if(char==='"')return JSON.parse(text.slice(start,at));
      if(char==='\\')at++;
      else if(char.charCodeAt(0)<32)invalid();
    }
    invalid();
  }
  function value(depth){
    if(depth>MAX_DEPTH||++nodes>MAX_NODES)invalid();
    whitespace();
    if(text[at]==='"')return {kind:'scalar',raw:JSON.stringify(string())};
    if(text[at]==='{'){
      at++;whitespace();const members=new Map();
      if(text[at]==='}'){at++;return {kind:'object',members};}
      while(at<text.length){
        const key=string();if(members.has(key))invalid();
        whitespace();if(text[at++]!==':')invalid();
        members.set(key,value(depth+1));whitespace();
        const separator=text[at++];
        if(separator==='}')return {kind:'object',members};
        if(separator!==',')invalid();
        whitespace();
      }
      invalid();
    }
    if(text[at]==='['){
      at++;whitespace();const children=[];
      if(text[at]===']'){at++;return {kind:'array',children};}
      while(at<text.length){
        children.push(value(depth+1));whitespace();const separator=text[at++];
        if(separator===']')return {kind:'array',children};
        if(separator!==',')invalid();
      }
      invalid();
    }
    for(const literal of ['true','false','null'])if(text.startsWith(literal,at)){
      at+=literal.length;return {kind:'scalar',raw:literal};
    }
    const number=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    number.lastIndex=at;const match=number.exec(text);if(!match)invalid();
    at=number.lastIndex;const raw=match[0],numeric=Number(raw);
    if(!Number.isFinite(numeric)||(Number.isInteger(numeric)&&!Number.isSafeInteger(numeric))
        ||decimal(raw)!==decimal(String(numeric)))invalid();
    return {kind:'scalar',raw};
  }
  const root=value(0);whitespace();if(at!==text.length||root.kind!=='object')invalid();
  return root;
}

function codePointOrder(a,b){
  const left=[...a],right=[...b];
  for(let i=0;i<Math.min(left.length,right.length);i++){
    const difference=left[i].codePointAt(0)-right[i].codePointAt(0);
    if(difference)return difference;
  }
  return left.length-right.length;
}

function canonical(node,python){
  if(node.kind==='scalar')return node.raw;
  if(node.kind==='array')return '['+node.children.map(child=>canonical(child,python)).join(',')+']';
  const sorted=[...node.members.keys()].sort(python?codePointOrder:undefined);
  // Match stable()+JSON.stringify in the existing JS writer: array-index keys
  // enumerate numerically even when Object.fromEntries received sorted keys.
  const keys=python?sorted:Object.keys(Object.fromEntries(sorted.map(key=>[key,null])));
  return '{'+keys.map(key=>JSON.stringify(key)+':'+canonical(node.members.get(key),python)).join(',')+'}';
}

// This verifies the original wire, never a Number-normalized or re-sealed row.
// It supports the Python ledger's Unicode ordering and the existing JS writer's
// enumeration, with number tokens retained verbatim in both canonical bodies.
export function parseVerifiedResearchLiveEventWire(text){
  const root=parseStrict(text),record=JSON.parse(text);
  if(!/^[a-f0-9]{64}$/.test(record.recordHash||'')
      ||typeof record.previousHash!=='string'
      ||!(record.previousHash==='GENESIS'||/^[a-f0-9]{64}$/.test(record.previousHash)))invalid();
  root.members.delete('recordHash');
  const matches=python=>crypto.createHash('sha256')
    .update(record.previousHash+'\n'+canonical(root,python)).digest('hex')===record.recordHash;
  if(!matches(true)&&!matches(false))invalid();
  return record;
}
