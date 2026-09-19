// Profile pictures are resized locally and stored in the existing, RLS-protected profile.
export function safeColor(value) {
  return /^#[\da-f]{6}$/i.test(value || '') ? value : null;
}
export function safeAvatar(value) {
  if (typeof value !== 'string') return null;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 90000) return value;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function inkFor(color) {
  const hex = safeColor(color);
  if (!hex) return '#191919';
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722 > .179 ? '#191919' : '#ffffff';
}
export async function resizeAvatar(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 사진을 골라 주세요.');
  if (file.size > 10*1024*1024) throw new Error('10MB 이하 사진을 골라 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('사진을 읽을 수 없어요.');
    const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=256;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,256,256);
    const side=Math.min(img.naturalWidth,img.naturalHeight);
    ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,256,256);
    const result=canvas.toDataURL('image/jpeg',.8);
    if (!safeAvatar(result)) throw new Error('사진이 너무 복잡해요. 다른 사진을 골라 주세요.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
export function createCustomization({sb,state,el,toast,errText,openSheet,closeSheet,openTab,levelForProfile}) {
  let catalog = new Map();
  async function loadCatalog() {
    const {data,error}=await sb.from('items').select('*');
    if(error) throw error;
    catalog=new Map((data||[]).map(item=>[item.id,item]));
  }
  function avatar(profile, cls='') {
    const box=el('div',`profile-avatar ${cls}`);
    const character=catalog.get(profile.equipped_character);
    box.textContent=character?.emoji || profile.nickname?.slice(0,1) || '👤';
    const src=safeAvatar(profile.avatar_url);
    if(src){ const img=el('img');img.src=src;img.alt=`${profile.nickname || ''} 프로필 사진`;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();box.append(img); }
    const frame=catalog.get(profile.equipped_frame);
    if(safeColor(frame?.color)){box.style.borderColor=frame.color;box.classList.add('has-frame');}
    return box;
  }
  function styleName(node,profile) { if(safeColor(profile.nickname_color))node.style.color=profile.nickname_color;return node; }
  function styleBubble(node,profile) {
    const color=safeColor(catalog.get(profile?.equipped_bubble)?.color);
    if(color){ node.style.background=color;node.style.color=inkFor(color);node.style.setProperty('--equipped-bubble',color); }
    return node;
  }
  async function saveProfile(patch) {
    const {data,error}=await sb.from('profiles').update(patch).eq('id',state.me.id).select('*').single();
    if(error)throw error;
    if(!data)throw new Error('저장하지 못했어요. 다시 로그인해 주세요.');
    state.me=data;
    return data;
  }
  async function ownedItems() {
    const {data,error}=await sb.from('inventory').select('item_id,count').eq('user_id',state.me.id);
    if(error)throw error;
    return (data||[]).map(row=>catalog.get(row.item_id)).filter(Boolean);
  }
  async function openEditor() {
    try { await loadCatalog();
      const {data,error}=await sb.from('profiles').select('*').eq('id',state.me.id).single();
      if(error)throw error; if(data)state.me=data;
      const owned=await ownedItems();
      openSheet('프로필 꾸미기',box=>buildEditor(box,owned));
    } catch(e){toast(errText(e));}
  }
  function buildEditor(box,owned) {
    box.classList.add('customize-sheet');
    const draft={...state.me};
    const preview=el('div','customize-preview');
    const status=el('div','muted small');status.setAttribute('role','status');
    function drawPreview(){
      preview.replaceChildren(avatar(draft,'large'),styleName(el('strong',null,draft.nickname),draft));
      preview.append(styleBubble(el('div','bubble-preview','오늘도 가가오톡 💬'),draft));
    }
    drawPreview();box.append(preview);
    const controls=el('fieldset','customize-controls');box.append(controls);
    async function perform(button,fn){
      controls.disabled=true;status.textContent='저장 중…';
      try{await fn();Object.assign(draft,state.me);drawPreview();status.textContent='저장됐어요';toast('저장됨');}
      catch(e){status.textContent=errText(e);}
      finally{controls.disabled=false;}
    }
    controls.append(el('h3',null,'프로필 사진'));
    const photo=el('input');photo.type='file';photo.accept='image/jpeg,image/png,image/webp';photo.setAttribute('aria-label','프로필 사진 선택');
    const save=el('button','primary','사진 저장');save.disabled=true;
    const remove=el('button',null,'사진 지우기');
    let selectedPhoto=null;
    photo.onchange=async()=>{
      const file=photo.files?.[0];if(!file)return;
      controls.disabled=true;save.disabled=true;status.textContent='사진 준비 중…';
      try{selectedPhoto=await resizeAvatar(file);draft.avatar_url=selectedPhoto;drawPreview();save.disabled=false;status.textContent='가운데를 정사각형으로 잘랐어요. 사진 저장을 눌러 주세요.';}
      catch(e){selectedPhoto=null;draft.avatar_url=state.me.avatar_url;drawPreview();status.textContent=errText(e);}
      finally{controls.disabled=false;}
    };
    save.onclick=()=>perform(save,async()=>{await saveProfile({avatar_url:selectedPhoto});save.disabled=true;photo.value='';});
    remove.onclick=()=>perform(remove,async()=>{await saveProfile({avatar_url:null});selectedPhoto=null;save.disabled=true;photo.value='';});
    const buttons=el('div','btn-row');buttons.append(save,remove);controls.append(photo,buttons,el('p','muted small','친구 목록과 채팅에 표시돼요. JPG·PNG·WebP, 최대 10MB.'));
    controls.append(el('h3',null,'닉네임 색 (Lv.5)'));
    const colors=el('div','color-options');
    [null,'#191919','#b42343','#2458a6','#19704a','#7543a0','#915300'].forEach(color=>{
      const btn=el('button','color-choice',color?'':'기본');btn.type='button';btn.setAttribute('aria-label',color?`닉네임 색 ${color}`:'기본 닉네임 색');
      if(color)btn.style.background=color;
      btn.disabled=!!color&&levelForProfile(state.me).level<5;
      btn.setAttribute('aria-pressed',String(state.me.nickname_color===color));
      btn.onclick=()=>perform(btn,async()=>{await saveProfile({nickname_color:color});colors.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));});
      colors.append(btn);
    });controls.append(colors);
    for(const [kind,label] of [['character','캐릭터'],['frame','테두리'],['bubble','말풍선']]){
      controls.append(el('h3',null,label));const grid=el('div','customize-grid');
      const field=`equipped_${kind}`;
      const reset=el('button','item','기본');reset.setAttribute('aria-pressed',String(!state.me[field]));grid.append(reset);
      const selectButton=btn=>grid.querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b===btn);b.setAttribute('aria-pressed',String(b===btn));});
      reset.onclick=()=>perform(reset,async()=>{await saveProfile({[field]:null});selectButton(reset);});
      owned.filter(item=>item.kind===kind).forEach(item=>{
        const required=Math.max(item.required_level||1,kind==='frame'?50:1);
        const locked=levelForProfile(state.me).level<required;
        const btn=el('button','item'+(state.me[field]===item.id?' on':''));btn.setAttribute('aria-pressed',String(state.me[field]===item.id));
        btn.append(el('b',null,item.emoji),el('span',null,item.name));
        if(locked)btn.append(el('small',null,`🔒 Lv.${required}`));
        btn.disabled=locked;
        btn.onclick=()=>perform(btn,async()=>{
          const {data,error}=await sb.rpc('equip_item',{p_item_id:item.id});if(error)throw error;
          if(!data)throw new Error('장착하지 못했어요. 다시 시도해 주세요.');
          state.me=Array.isArray(data)?data[0]:data;selectButton(btn);
        });grid.append(btn);
      });
      controls.append(grid);
      if(!owned.some(item=>item.kind===kind))controls.append(el('p','muted small','가가 뽑기에서 아이템을 얻으면 여기에 나타나요.'));
    }
    controls.append(el('p','muted small','캐릭터는 사진을 지우면 보여요. 테두리는 Lv.50부터 사용할 수 있어요.'));
    box.append(status);
    const done=el('button','primary','완료');done.onclick=()=>{if(controls.disabled)return;closeSheet();openTab('me');};box.append(done);
  }
  function addMeControls(card) {
    card.prepend(avatar(state.me,'large'));
    styleName(card.querySelector('.title'),state.me);
    const edit=el('button','profile-edit','프로필 꾸미기');edit.onclick=openEditor;card.append(edit);
  }
  function openFriend(person,startChat) {
    openSheet(person.nickname,box=>{
      const hero=el('div','customize-preview');hero.append(avatar(person,'large'),styleName(el('strong',null,person.nickname),person));
      if(person.bio)hero.append(el('p',null,person.bio));
      if(person.show_level_badge)hero.append(el('span','chip',`Lv.${levelForProfile(person).level}`));
      box.append(hero);const go=el('button','primary','1:1 채팅');go.onclick=()=>{closeSheet();startChat();};box.append(go);
    });
  }
  async function stickers() {
    try{await loadCatalog();const items=(await ownedItems()).filter(i=>i.kind==='sticker');
      openSheet('내 스티커',box=>{
        if(!items.length)box.append(el('p','muted','가가 뽑기에서 스티커를 얻으면 여기에 나타나요.'));
        const grid=el('div','customize-grid');
        items.forEach(item=>{const b=el('button','item');b.append(el('b',null,item.emoji),el('span',null,item.name));b.disabled=levelForProfile(state.me).level<(item.required_level||1);
          b.onclick=()=>{const input=document.getElementById('chat-input');input.value+=item.emoji;closeSheet();input.focus();};grid.append(b);});box.append(grid);
        box.append(el('p','muted small','스티커를 고른 뒤 전송 버튼을 눌러 주세요.'));
      });
    }catch(e){toast(errText(e));}
  }
  return {loadCatalog,avatar,styleName,styleBubble,addMeControls,openEditor,openFriend,stickers};
}
