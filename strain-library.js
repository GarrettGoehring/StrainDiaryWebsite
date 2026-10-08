(() => {
  const card=document.querySelector('.strain-feature-card');
  const list=document.getElementById('strain-results');
  const input=document.getElementById('strain-search-input');
  const count=document.getElementById('strain-count');
  const more=document.getElementById('strain-load-more');
  const pageSize=48;
  let strains=[];
  let filtered=[];
  let shown=pageSize;
  let spotlightIndex=0;
  let timer=null;
  let spotlightVisible=false;
  let loading=false;
  let loaded=false;
  const prefersReducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cap=value=>value ? value.replace(/\b\w/g,letter=>letter.toUpperCase()) : '';
  const clean=value=>String(value||'').trim();
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const renderSpotlight=()=>{
    if(!card||!strains.length)return;
    const item=strains[spotlightIndex%strains.length];
    card.querySelector('.strain-feature-name').textContent=item.name;
    card.querySelector('.strain-feature-type').textContent=item.type ? cap(item.type)+' profile' : 'Strain profile';
    card.querySelector('.strain-feature-crosses').textContent=item.crosses ? 'Lineage: '+item.crosses : 'Explore this strain profile';
    card.querySelector('.strain-feature-count').textContent='• '+(spotlightIndex+1)+' / '+strains.length+' bundled';
    card.setAttribute('aria-label','Explore '+item.name+' and search the strain library');
  };
  const tags=(label,items)=>{
    if(!items?.length)return '';
    const values=items.slice(0,4).map(value=>'<span>'+escapeHTML(value)+'</span>').join('');
    return '<div class="strain-result-label">'+label+'</div><div class="strain-tags">'+values+'</div>';
  };
  const renderResults=()=>{
    if(!list)return;
    const results=filtered.slice(0,shown);
    list.innerHTML=results.length?results.map(item=>'<article class="strain-result"><div class="strain-result-top"><h3>'+escapeHTML(item.name)+'</h3>'+(item.type?'<span class="strain-result-type">'+escapeHTML(cap(item.type))+'</span>':'')+'</div>'+(item.crosses?'<p class="strain-result-crosses">Lineage: '+escapeHTML(item.crosses)+'</p>':'')+tags('FLAVORS',item.flavors)+tags('TERPENES',item.terpenes)+tags('COMMON EFFECTS',item.effects)+'</article>').join(''):'<div class="strain-empty">No strains found. Try another name, flavor or terpene.</div>';
    if(count)count.textContent=filtered.length===strains.length?strains.length.toLocaleString()+' bundled profiles':filtered.length.toLocaleString()+' matching bundled profiles';
    if(more){more.hidden=shown>=filtered.length;more.textContent='Show more strains ('+Math.min(pageSize,filtered.length-shown)+' more)';}
  };
  const search=()=>{
    const query=clean(input?.value).toLowerCase();
    filtered=query?strains.filter(item=>[item.name,item.type,item.crosses,...item.flavors,...item.terpenes,...item.effects].join(' ').toLowerCase().includes(query)):strains;
    shown=pageSize;
    renderResults();
  };
  const stopTimer=()=>{if(timer){clearInterval(timer);timer=null;}};
  const startTimer=()=>{
    if(!card||prefersReducedMotion||!spotlightVisible||document.hidden||timer||strains.length<2)return;
    timer=window.setInterval(()=>{spotlightIndex=(spotlightIndex+1)%strains.length;renderSpotlight();},6500);
  };
  const loadCatalog=()=>{
    if(loading||loaded)return;
    loading=true;
    fetch('strain-library.json',{cache:'no-cache'})
      .then(response=>{if(!response.ok)throw new Error('catalog');return response.json();})
      .then(data=>{
        strains=Array.isArray(data)?data:[];
        filtered=strains;
        if(!strains.length)throw new Error('empty catalog');
        loaded=true;
        if(count&&!list)count.textContent=strains.length.toLocaleString()+' strain profiles';
        if(list)renderResults();
        renderSpotlight();
        startTimer();
      })
      .catch(()=>{
        if(count)count.textContent='Strain profiles are temporarily unavailable';
        if(list)list.innerHTML='<div class="strain-empty">The strain library could not load right now. Please refresh the page and try again.</div>';
      })
      .finally(()=>{loading=false;});
  };
  if(list)loadCatalog();
  if(card){
    if('IntersectionObserver'in window){
      const observer=new IntersectionObserver(entries=>{
        const entry=entries[0];
        spotlightVisible=Boolean(entry?.isIntersecting);
        if(spotlightVisible)loadCatalog();
        if(spotlightVisible)startTimer();else stopTimer();
      },{rootMargin:'160px 0px',threshold:0});
      observer.observe(card);
    }else{
      spotlightVisible=true;
      loadCatalog();
    }
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTimer();else startTimer();});
  input?.addEventListener('input',search);
  more?.addEventListener('click',()=>{shown+=pageSize;renderResults();});
})();
