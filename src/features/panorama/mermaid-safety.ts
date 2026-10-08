export function assertSafeUcDiagram(code:string){
  const value=code.trim(),lower=value.toLowerCase();
  if(!value||value.length>100000)throw new Error('图代码为空或超过安全渲染限制');
  if(!/^(flowchart|graph) (TD|TB|BT|LR|RL)([ ;]|$)/i.test(value.split(String.fromCharCode(10))[0].trim()))throw new Error('UC图仅支持flowchart/graph流程图语法');
  if(value.includes('%%{')||value.includes('@{')||['<script','<iframe','<img','<style','<foreignobject','javascript:','data:','https:','http:'].some(v=>lower.includes(v))||value.split(String.fromCharCode(10)).some(line=>line.trimStart().startsWith('click ')))throw new Error('图代码包含不允许的配置、脚本或外部交互，请由Agent返回纯UC关系图');
  return value;
}
