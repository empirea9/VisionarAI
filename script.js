function startRedactionDemo() {
  const demo = document.querySelector('[data-redaction-demo]');
  if (!demo) return;
  const body = demo.querySelector('.window-body');
  const scanner = demo.querySelector('.scan');
  const targets = Array.from(body.querySelectorAll('.pii-target'));
  
  if (!scanner || !targets.length) return;

  const originalTexts = targets.map(t => t.textContent);
  let lastY = -1;

  function loop() {
    const scannerRect = scanner.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const currentY = scannerRect.top - bodyRect.top;
    
    // If scanner jumps back to top, reset the text
    if (lastY !== -1 && currentY < lastY - 20) {
      targets.forEach((target, i) => {
        target.textContent = originalTexts[i];
        target.style.color = 'inherit';
        target.style.background = 'transparent';
      });
    } else {
      // Check if scanner passed over target
      targets.forEach((target, i) => {
        const targetRect = target.getBoundingClientRect();
        if (scannerRect.bottom > targetRect.top + targetRect.height / 2) {
          if (target.textContent !== '[REDACTED]') {
            target.textContent = '[REDACTED]';
            target.style.color = '#fff';
            target.style.background = '#000';
          }
        }
      });
    }
    
    lastY = currentY;
    requestAnimationFrame(loop);
  }
  
  requestAnimationFrame(loop);
}

function setupCapabilityFlow() {
  const steps = Array.from(document.querySelectorAll('.flow-step'));
  const detail = document.getElementById('flowDetail');
  if (!steps.length || !detail) return;

  const setActive = (step) => {
    steps.forEach((item) => item.classList.remove('active'));
    step.classList.add('active');
    detail.textContent = step.dataset.detail || '';
  };

  steps.forEach((step) => {
    step.addEventListener('mouseenter', () => setActive(step));
    step.addEventListener('focus', () => setActive(step));
    step.addEventListener('click', () => setActive(step));
  });
}


function setupMobileAutoScroll() {
  const flowSteps = document.querySelector('.flow-steps');
  if (!flowSteps) return;

  if (window.innerWidth > 768) return;

  let scrollDir = 1;
  let isInteracting = false;

  const pauseAutoScroll = () => {
    isInteracting = true;
    if (window.autoScrollTimeout) clearTimeout(window.autoScrollTimeout);
    window.autoScrollTimeout = setTimeout(() => { isInteracting = false; }, 2500);
  };

  flowSteps.addEventListener('touchstart', pauseAutoScroll, {passive: true});
  flowSteps.addEventListener('touchmove', pauseAutoScroll, {passive: true});
  flowSteps.addEventListener('scroll', pauseAutoScroll, {passive: true});

  setInterval(() => {
    if (isInteracting) return;
    
    flowSteps.scrollLeft += scrollDir;
    
    if (flowSteps.scrollLeft + flowSteps.clientWidth >= flowSteps.scrollWidth - 1) {
      scrollDir = -1;
    } else if (flowSteps.scrollLeft <= 0) {
      scrollDir = 1;
    }
  }, 25);
}
function setupScrollReveal() {
  const elements = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px"
  });

  elements.forEach(el => observer.observe(el));
}

window.addEventListener('DOMContentLoaded', () => {
  setupCapabilityFlow();
  startRedactionDemo();
  setupScrollReveal();
  setupMobileAutoScroll();
});

// FAQ smooth open/close
document.querySelectorAll('.faq-item').forEach(details => {
  const summary = details.querySelector('summary');
  const content = details.querySelector('.faq-content');
  
  let animation = null;
  let isClosing = false;
  let isExpanding = false;
  
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    details.style.overflow = 'hidden';
    
    if (isClosing || !details.open) {
      openDetails();
    } else if (isExpanding || details.open) {
      shrinkDetails();
    }
  });
  
  function shrinkDetails() {
    isClosing = true;
    const startHeight = details.offsetHeight + 'px';
    const endHeight = summary.offsetHeight + 'px';
    
    if (animation) { animation.cancel(); }
    
    animation = details.animate({ height: [startHeight, endHeight] }, {
      duration: 250,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    
    animation.onfinish = () => {
      details.removeAttribute('open');
      animation = null;
      isClosing = false;
    };
    animation.oncancel = () => {
      isClosing = false;
    };
  }
  
  function openDetails() {
    details.style.height = details.offsetHeight + 'px';
    details.setAttribute('open', '');
    window.requestAnimationFrame(() => {
      isExpanding = true;
      const startHeight = details.offsetHeight + 'px';
      const endHeight = (summary.offsetHeight + content.offsetHeight) + 'px';
      
      if (animation) { animation.cancel(); }
      
      animation = details.animate({ height: [startHeight, endHeight] }, {
        duration: 250,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
      });
      
      animation.onfinish = () => {
        details.style.height = '';
        animation = null;
        isExpanding = false;
      };
      animation.oncancel = () => {
        isExpanding = false;
      };
    });
  }
});

// Dark Mode Toggle
(function() {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;

  const currentTheme = localStorage.getItem('theme');
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
    toggleBtn.textContent = 'â˜€ï¸';
  } else {
    toggleBtn.textContent = 'ðŸŒ™';
  }

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    document.body.classList.toggle('dark-theme');
    
    if (document.body.classList.contains('dark-theme')) {
      localStorage.setItem('theme', 'dark');
      toggleBtn.textContent = 'â˜€ï¸';
    } else {
      localStorage.setItem('theme', 'light');
      toggleBtn.textContent = 'ðŸŒ™';
    }
  });
})();

// OVERRIDE THEME TOGGLE LOGIC WITH CLEAN SVGS
(function() {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;

  const sunSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  const moonSVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  // Reset the toggleBtn to remove the old listener (by cloning it)
  const newBtn = toggleBtn.cloneNode(true);
  toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);

  const currentTheme = localStorage.getItem('theme');
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
    newBtn.innerHTML = sunSVG;
  } else {
    newBtn.innerHTML = moonSVG;
  }

  newBtn.addEventListener('click', (e) => {
    e.preventDefault();
    document.body.classList.toggle('dark-theme');
    
    if (document.body.classList.contains('dark-theme')) {
      localStorage.setItem('theme', 'dark');
      newBtn.innerHTML = sunSVG;
    } else {
      localStorage.setItem('theme', 'light');
      newBtn.innerHTML = moonSVG;
    }
  });
})();


