const menuButton=document.querySelector('.menu-button');
const nav=document.querySelector('#site-nav');
menuButton?.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')==='true';menuButton.setAttribute('aria-expanded',String(!open));nav?.classList.toggle('open',!open)});

const gate=document.querySelector('.age-gate');
let verified=false;
try{verified=localStorage.getItem('sd-age-ok')==='1'}catch{}
if(gate&&!verified)gate.hidden=false;
document.querySelector('.age-yes')?.addEventListener('click',()=>{try{localStorage.setItem('sd-age-ok','1')}catch{}if(gate)gate.hidden=true});

const revealTargets=document.querySelectorAll('.steps-grid article,.feature-grid article,.screen-grid figure,.reveal');
revealTargets.forEach((el,index)=>{el.classList.add('reveal');el.style.transitionDelay=`${Math.min(index%4,3)*55}ms`});
if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}})},{threshold:.12,rootMargin:'0px 0px -35px'});revealTargets.forEach(el=>observer.observe(el))}else{revealTargets.forEach(el=>el.classList.add('is-visible'))}

const form=document.querySelector('.contact-form');
form?.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');const status=form.querySelector('.form-status');button.disabled=true;button.textContent='Sending…';try{const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Request failed');form.reset();status.textContent='Sent. Thanks—I’ll take a look.';button.textContent='Sent'}catch{status.innerHTML='That did not send. Email me at <a href="mailto:support@straindiary.com">support@straindiary.com</a> instead.';button.textContent='Try again';button.disabled=false}});
