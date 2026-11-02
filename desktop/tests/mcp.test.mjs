import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {McpManager,validateServer} from '../core/mcp.mjs';
test('MCP connects a real stdio child, discovers and executes tools, closes process',async t=>{
 const config={name:'Test MCP',transport:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/mcp-server.mjs',import.meta.url))]};
 const manager=new McpManager({state:{mcpServers:[config]}},()=>null);t.after(()=>manager.close());
 const tools=await manager.list(config.name);assert.equal(tools[0].name,'echo');
 const result=await manager.call(config.name,'echo',{text:'Verified MCP'},new AbortController().signal);assert.equal(result.content[0].text,'Verified MCP');
 await assert.rejects(manager.call(config.name,'unknown',{},new AbortController().signal));
 await manager.disconnect(config.name);assert.equal(manager.status()[config.name].status,'disconnected');assert.equal(manager.sessions.size,0);
});
test('MCP configuration accepts localhost and named secrets, rejects raw secret references',()=>{
 validateServer({name:'Local',transport:'http',url:'http://127.0.0.1:9000/mcp',secretRef:'CONNECTOR_LOCAL'});
 assert.throws(()=>validateServer({name:'Remote',transport:'http',url:'http://example.com/mcp'}));
 assert.throws(()=>validateServer({name:'Local',transport:'stdio',command:'node',args:[],envSecrets:{KEY:'actual-secret'}}));
});
