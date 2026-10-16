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
  const updateCountLabels=total=>document.querySelectorAll('[data-strain-count]').forEach(label=>{label.textContent=Number(total).toLocaleString();});
  const loadMetadata=()=>fetch('strain-library-meta.json',{cache:'no-cache'}).then(response=>response.ok?response.json():null).then(meta=>{if(meta?.total)updateCountLabels(meta.total);}).catch(()=>{});
  const renderSpotlight=()=>{
    if(!card||!strains.length)return;
    const item=strains[spotlightIndex%strains.length];
    card.querySelector('.strain-feature-name').textContent=item.name;
    card.querySelector('.strain-feature-type').textContent=item.type ? cap(item.type)+' profile' : 'Strain profile';
    card.querySelector('.strain-feature-crosses').textContent=item.crosses ? 'Lineage: '+item.crosses : 'Explore this strain profile';
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
    if(count)count.textContent=filtered.length===strains.length?strains.length.toLocaleString()+' profiles currently searchable here':filtered.length.toLocaleString()+' matching profiles here';
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
        updateCountLabels(strains.length);
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
  loadMetadata();
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
  const globalList=document.getElementById('global-shared-results');
  const globalCount=document.getElementById('global-shared-count');
  const globalMore=document.getElementById('global-shared-more');
  const globalPageSize=12;
  let globalItems=[];
  let globalShown=globalPageSize;
  const formatDate=value=>{
    if(!value)return '';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date);
  };
  const globalTags=(items,limit=3)=>(items||[]).slice(0,limit).map(value=>'<span>'+escapeHTML(value)+'</span>').join('');
  const renderGlobal=()=>{
    if(!globalList)return;
    const visible=globalItems.slice(0,globalShown);
    globalList.innerHTML=visible.length?visible.map(item=>{
      const owner=clean(item.displayName)||clean(item.username)||'Strain Diary community';
      const handle=clean(item.username);
      const initial=(owner.charAt(0)||'S').toUpperCase();
      const details=[item.brand,item.form,item.extractType,item.type,item.potency].map(clean).filter(Boolean).slice(0,4).join(' · ');
      const shared=formatDate(item.sharedAt);
      const rating=Number(item.rating)>0?'<span class="global-rating">★ '+Number(item.rating).toFixed(1)+'</span>':'';
      const review=clean(item.review)?'<p class="global-review">“'+escapeHTML(item.review)+'”</p>':'';
      const profile=handle?'<a class="global-profile-link" href="straindiary://profile?username='+encodeURIComponent(handle)+'">@'+escapeHTML(handle)+'</a>':'<span>'+escapeHTML(owner)+'</span>';
      const chips=[...((item.flavors||[]).slice(0,2)),...((item.effects||[]).slice(0,2)),...((item.terpenes||[]).slice(0,2))];
      return '<article class="global-shared-card"><div class="global-card-owner"><span class="global-avatar">'+escapeHTML(initial)+'</span><div><strong>'+escapeHTML(owner)+'</strong><small>Shared by '+profile+(shared?' · '+escapeHTML(shared):'')+'</small></div></div><div class="global-card-title"><h3>'+escapeHTML(item.name)+'</h3>'+rating+'</div>'+(details?'<p class="global-details">'+escapeHTML(details)+'</p>':'')+(chips.length?'<div class="global-card-tags">'+globalTags(chips,6)+'</div>':'')+review+'</article>';
    }).join(''):'<div class="strain-empty">No Global strains are available right now. Check back soon.</div>';
    if(globalCount)globalCount.textContent=globalItems.length.toLocaleString()+' recent public '+(globalItems.length===1?'strain':'strains');
    if(globalMore){
      globalMore.hidden=globalShown>=globalItems.length;
      globalMore.textContent='Show more shared strains ('+Math.min(globalPageSize,globalItems.length-globalShown)+' more)';
    }
  };
  const loadGlobal=()=>{
    if(!globalList)return;
    fetch('global-shared-strains.json',{cache:'no-cache'})
      .then(response=>{if(!response.ok)throw new Error('global feed');return response.json();})
      .then(data=>{globalItems=Array.isArray(data)?data:[];renderGlobal();})
      .catch(()=>{
        if(globalCount)globalCount.textContent='Global feed temporarily unavailable';
        globalList.innerHTML='<div class="strain-empty">The Global feed could not load right now. Please try again later.</div>';
      });
  };
  loadGlobal();
  globalMore?.addEventListener('click',()=>{globalShown+=globalPageSize;renderGlobal();});

  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTimer();else startTimer();});
  input?.addEventListener('input',search);
  more?.addEventListener('click',()=>{shown+=pageSize;renderResults();});
})();
