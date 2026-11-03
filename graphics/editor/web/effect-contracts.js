import { Editor } from '/dist/editor.js';
const check = (condition, message) => { if (!condition) throw new Error(message); };
function pixels(editor) {
  editor.render();
  const copy = document.createElement('canvas'); copy.width = editor.canvas.width; copy.height = editor.canvas.height;
  const context = copy.getContext('2d'); context.drawImage(editor.canvas, 0, 0);
  const data = context.getImageData(0, 0, copy.width, copy.height).data;
  return (x, y) => Array.from(data.slice((y * copy.width + x) * 4, (y * copy.width + x) * 4 + 4));
}
export async function runEffectContracts() {
  const canvas = document.createElement('canvas'); Object.assign(canvas.style, {width:'240px',height:'160px'}); document.body.append(canvas);
  const e = await Editor.create({canvas, wasm:'/dist/editor.wasm',autoRender:false,pixelRatio:1,background:'#000000'});
  const errors = []; e.on('error', event => errors.push(event.detail.error.message));
  const rect = {x:40,y:40,width:80,height:80,fill:'#ff0000'};
  try {
    e.load({version:1,elements:[{...rect,layerBlur:8}]}); let p=pixels(e);
    check(p(35,80)[0]>20 && p(35,80)[0]<110 && p(80,80)[0]>240,'Layer blur must spread outside the shape and preserve its center');
    e.culling=false; const unculled=pixels(e); check(unculled(35,80).join()===p(35,80).join(),'Blur culling preserves the tail'); e.culling=true;
    e.load({version:1,elements:[{...rect,saturation:0}]}); p=pixels(e);
    check(Math.abs(p(80,80)[0]-54)<3 && p(80,80)[0]===p(80,80)[1] && p(80,80)[1]===p(80,80)[2],'Saturation zero produces Rec.709 grayscale');
    e.load({version:1,elements:[rect,{...rect,fill:'#0000ff',blendMode:'screen'}]}); p=pixels(e);
    check(p(80,80)[0]===255 && p(80,80)[2]===255,'Screen blend combines red and blue');
    const top=[...e.elements()][1].id; e.update(top,{blendMode:'multiply'}); p=pixels(e);
    check(p(80,80)[0]===0 && p(80,80)[2]===0,'Multiply blend reads preceding content');
    e.undo(); check(pixels(e)(80,80)[0]===255,'Undo restores blend mode');
    const background=[{x:0,y:0,width:120,height:160,fill:'#ff0000'},{x:120,y:0,width:120,height:160,fill:'#0000ff'}];
    e.load({version:1,elements:[...background,{x:80,y:30,width:80,height:100,radius:15,fill:'#ffffff00',backdropBlur:8}]}); p=pixels(e);
    check(p(116,80)[0]>80 && p(116,80)[2]>40,'Backdrop blur mixes preceding colors through a transparent fill');
    check(p(116,10)[0]===255 && p(116,10)[2]===0,'Backdrop blur is clipped to the element');
    check(p(80,30)[0]===255 && p(80,30)[2]===0,'Backdrop blur respects rounded corners');
    e.load({version:1,elements:[{...rect,fill:'#ffffff',innerShadow:'#000000ff',innerBlur:8,innerShadowX:6,innerShadowY:6}]}); p=pixels(e);
    check(p(42,80)[0]<180 && p(80,80)[0]>245 && p(35,80)[0]===0,'Inner shadows shade only the interior');
    e.load({version:1,elements:[{...rect,layerBlur:6,saturation:0,backdropBlur:4,innerShadow:'#00000080'}]}); pixels(e);
    const resources=e.diagnostics.gpuHandles;
    for(let i=0;i<12;i++) { e.setViewport({x:i%2,y:0,zoom:1}); pixels(e); }
    check(e.diagnostics.gpuHandles<=resources+2,'Effect resources stabilize across repeated frames');
    check(errors.length===0, errors.join('\n'));
    return {passed:12,gpuHandles:e.diagnostics.gpuHandles};
  } finally {e.destroy(); canvas.remove();}
}
