import {Store} from '../../core/store.mjs';
const store=new Store(process.argv[2]),task=store.state.tasks[0];
task.conversation.push({id:'committed-before-crash',role:'assistant',content:'Confirmado antes del corte'});store.save(task);
store.backend.db.exec('BEGIN IMMEDIATE');store.backend.db.prepare('UPDATE tasks SET data=? WHERE id=?').run('UNCOMMITTED INVALID JSON',task.id);
process.stdout.write('READY\n');setInterval(()=>{},1000);
