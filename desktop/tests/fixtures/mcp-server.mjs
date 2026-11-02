// Protocol fixture: no network or user files are accessed.
import readline from 'node:readline';
const reader=readline.createInterface({input:process.stdin});
reader.on('line',line=>{
 const message=JSON.parse(line);if(message.id===undefined)return;
 let result={};
 if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'nexus-test-server',version:'1.0'}};
 if(message.method==='tools/list')result={tools:[{name:'echo',description:'Return test input',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]};
 if(message.method==='tools/call')result={content:[{type:'text',text:message.params.arguments.text}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');
});
