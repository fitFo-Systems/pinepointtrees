/* =============================================
   Pine Point Tree Service — Main JS
   Nav, mobile menu, scroll, before/after sliders
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initMobileMenu();
  initBeforeAfterSliders();
  initBACarousel();
  initTimelineArrows();
  initVideo();
  initLightbox();
  initTestimonials();
});

/* --- Smart Video: autoplay on desktop, lazy on mobile --- */
function initVideo() {
  const video = document.getElementById('heroVideo');
  const playHint = document.getElementById('videoPlayHint');
  if (!video) return;

  // Try to autoplay — if it fails, show tap-to-play button
  function tryPlay() {
    var playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(function() {
        // Autoplay worked — hide play button
        if (playHint) playHint.style.display = 'none';
      }).catch(function() {
        // Autoplay blocked — show play button
        if (playHint) {
          playHint.style.display = 'flex';
          playHint.addEventListener('click', function() {
            video.muted = true;
            video.play();
            playHint.style.display = 'none';
          });
        }
      });
    }
  }

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    // On mobile, wait until video is visible to attempt play
    video.preload = 'metadata';
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          tryPlay();
          observer.disconnect();
        }
      });
    }, { threshold: 0.3 });
    observer.observe(video);
  } else {
    video.preload = 'auto';
    tryPlay();
  }
}

/* --- Sticky Navigation --- */
function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  function updateNav() {
    if (window.scrollY > 80) {
      nav.classList.remove('nav--transparent');
      nav.classList.add('nav--solid');
    } else {
      nav.classList.remove('nav--solid');
      nav.classList.add('nav--transparent');
    }
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();
}

/* --- Mobile Menu --- */
function initMobileMenu() {
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobileNav');
  if (!hamburger || !mobileNav) return;

  hamburger.addEventListener('click', () => {
    mobileNav.classList.toggle('active');
    hamburger.classList.toggle('active');
  });
}

function closeMobileNav() {
  const mobileNav = document.getElementById('mobileNav');
  const hamburger = document.getElementById('hamburger');
  if (mobileNav) mobileNav.classList.remove('active');
  if (hamburger) hamburger.classList.remove('active');
}

/* --- Before/After Sliders (drag + tap to toggle) --- */
function initBeforeAfterSliders() {
  document.querySelectorAll('.ba-slider').forEach(initSlider);
}

function initSlider(slider) {
  const afterImg = slider.querySelector('.ba-slider__after');
  const divider = slider.querySelector('.ba-slider__divider');
  const handle = slider.querySelector('.ba-slider__handle');
  if (!afterImg || !divider || !handle) return;

  let isDragging = false;
  let currentPercent = 5; // Start showing almost all "before" — user slides right to reveal "after"

  function setPosition(percent) {
    percent = Math.max(2, Math.min(98, percent));
    currentPercent = percent;
    afterImg.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    divider.style.left = percent + '%';
    handle.style.left = percent + '%';
  }

  function setFromX(x) {
    const rect = slider.getBoundingClientRect();
    setPosition(((x - rect.left) / rect.width) * 100);
  }

  // Drag behavior
  function onStart(e) {
    isDragging = true;
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    setFromX(x);
  }

  function onMove(e) {
    if (!isDragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    setFromX(x);
  }

  function onEnd() {
    isDragging = false;
  }

  slider.addEventListener('mousedown', onStart);
  slider.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  // Tap to toggle (mobile-friendly: tap left side = show before, right = show after)
  slider.addEventListener('click', function(e) {
    if (isDragging) return; // don't trigger on drag end
    const rect = slider.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickPercent = (clickX / rect.width) * 100;

    // If they tap near the current divider, toggle between 25% and 75%
    if (Math.abs(clickPercent - currentPercent) < 15) {
      setPosition(currentPercent < 50 ? 75 : 25);
    } else {
      setPosition(clickPercent);
    }
  });

  // Arrow buttons — mobile only (desktop uses drag/click, arrows add clutter)
  if (window.innerWidth <= 768) {
    const arrowLeft = document.createElement('button');
    arrowLeft.className = 'ba-arrow ba-arrow--left';
    arrowLeft.innerHTML = '&#9664;';
    arrowLeft.setAttribute('aria-label', 'Show before');
    arrowLeft.addEventListener('click', function(e) {
      e.stopPropagation();
      setPosition(Math.max(5, currentPercent - 25));
    });

    const arrowRight = document.createElement('button');
    arrowRight.className = 'ba-arrow ba-arrow--right';
    arrowRight.innerHTML = '&#9654;';
    arrowRight.setAttribute('aria-label', 'Show after');
    arrowRight.addEventListener('click', function(e) {
      e.stopPropagation();
      setPosition(Math.min(95, currentPercent + 25));
    });

    slider.appendChild(arrowLeft);
    slider.appendChild(arrowRight);
  }

  // Set initial position — start with "before" fully visible
  setPosition(5);
}

/* --- Timeline Arrow Navigation --- */
function initTimelineArrows() {
  document.querySelectorAll('.timeline-scroll').forEach(function(scroll) {
    const wrapper = scroll.parentElement;

    // Create arrow buttons
    const leftBtn = document.createElement('button');
    leftBtn.className = 'timeline-arrow timeline-arrow--left';
    leftBtn.innerHTML = '&#9664;';
    leftBtn.setAttribute('aria-label', 'Scroll left');

    const rightBtn = document.createElement('button');
    rightBtn.className = 'timeline-arrow timeline-arrow--right';
    rightBtn.innerHTML = '&#9654;';
    rightBtn.setAttribute('aria-label', 'Scroll right');

    // Make wrapper position relative for arrow placement
    wrapper.style.position = 'relative';
    wrapper.appendChild(leftBtn);
    wrapper.appendChild(rightBtn);

    const scrollAmount = 280; // roughly one card width

    leftBtn.addEventListener('click', function() {
      scroll.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    rightBtn.addEventListener('click', function() {
      scroll.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    // Show/hide arrows based on scroll position
    function updateArrows() {
      leftBtn.style.display = scroll.scrollLeft > 10 ? 'flex' : 'none';
      rightBtn.style.display = scroll.scrollLeft < (scroll.scrollWidth - scroll.clientWidth - 10) ? 'flex' : 'none';
    }

    scroll.addEventListener('scroll', updateArrows, { passive: true });
    updateArrows();
    window.addEventListener('load', updateArrows);
  });
}

/* --- Before/After Carousel (mobile: one at a time) --- */
function initBACarousel() {
  const carousel = document.getElementById('baCarousel');
  if (!carousel) return;

  const sliders = carousel.querySelectorAll('.ba-slider');
  const counter = carousel.querySelector('.ba-carousel__counter');
  const prevBtn = carousel.querySelector('.ba-carousel__btn--prev');
  const nextBtn = carousel.querySelector('.ba-carousel__btn--next');
  if (!sliders.length || !counter || !prevBtn || !nextBtn) return;

  let current = 0;
  const total = sliders.length;
  const isMobile = window.innerWidth <= 768;

  function showSlide(index) {
    current = index;
    sliders.forEach((s, i) => {
      s.classList.toggle('ba-active', i === current);
    });
    counter.textContent = (current + 1) + ' / ' + total;
  }

  if (isMobile) {
    // Activate carousel: show first, hide rest
    showSlide(0);

    prevBtn.addEventListener('click', function() {
      showSlide(current > 0 ? current - 1 : total - 1);
    });

    nextBtn.addEventListener('click', function() {
      showSlide(current < total - 1 ? current + 1 : 0);
    });
  } else {
    // Desktop: show all, no carousel behavior needed
    sliders.forEach(s => s.classList.add('ba-active'));
  }
}

/* --- Testimonials (data-driven from data/reviews.json) --- */
function initTestimonials() {
  const carousel = document.getElementById('testimonialsCarousel');
  const grid = document.getElementById('testimonialsGrid');
  const counter = document.getElementById('testimonialsCounter');
  const prevBtn = carousel && carousel.querySelector('.testimonials-nav__btn--prev');
  const nextBtn = carousel && carousel.querySelector('.testimonials-nav__btn--next');
  if (!carousel || !grid || !counter || !prevBtn || !nextBtn) return;

  fetch('data/reviews.json', { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) { renderTestimonials(data.reviews || [], data._meta || {}); })
    .catch(function() { carousel.style.display = 'none'; });

  function renderTestimonials(reviews, meta) {
    const sorted = reviews.slice().sort(function(a, b) {
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return tb - ta;
    });

    const perPage = window.innerWidth <= 1024 ? 1 : 3;
    const pages = Math.max(1, Math.ceil(sorted.length / perPage));
    let page = 0;

    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const googleReviewsUrl = meta.googlePlaceId
      ? 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(meta.googlePlaceId)
      : null;

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function formatMonthYear(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    function sourceLineHtml(r) {
      const source = r.source || '';
      const date = formatMonthYear(r.timestamp);
      const label = date ? escapeHtml(source) + ' &middot; ' + date : escapeHtml(source);
      if (source === 'Google' && googleReviewsUrl) {
        return '<a class="testimonial-card__source-link" href="' + googleReviewsUrl +
               '" target="_blank" rel="noopener">' + label + '</a>';
      }
      return label;
    }

    function cardHtml(r) {
      const stars = '&#9733;'.repeat(Math.max(1, Math.min(5, r.rating || 5)));
      return (
        '<div class="testimonial-card">' +
          '<div class="testimonial-card__stars">' + stars + '</div>' +
          '<p class="testimonial-card__quote">&ldquo;' + escapeHtml(r.text || '') + '&rdquo;</p>' +
          '<p class="testimonial-card__author">' + escapeHtml(r.displayName || '') + '</p>' +
          '<p class="testimonial-card__location">' + sourceLineHtml(r) + '</p>' +
        '</div>'
      );
    }

    function show(i) {
      page = Math.max(0, Math.min(pages - 1, i));
      const start = page * perPage;
      const slice = sorted.slice(start, start + perPage);
      grid.innerHTML = slice.map(cardHtml).join('');
      counter.textContent = (page + 1) + ' / ' + pages;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page === pages - 1;
    }

    prevBtn.addEventListener('click', function() { show(page - 1); });
    nextBtn.addEventListener('click', function() { show(page + 1); });

    if (pages <= 1) {
      carousel.querySelector('.testimonials-nav').style.display = 'none';
    }

    show(0);
  }
}

/* --- Gallery Lightbox --- */
function initLightbox() {
  // Create lightbox overlay
  const overlay = document.createElement('div');
  overlay.id = 'lightbox';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;cursor:pointer;justify-content:center;align-items:center;padding:24px;';
  overlay.innerHTML = '<img style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" id="lightboxImg"><button style="position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:2rem;cursor:pointer;line-height:1;">&times;</button>';
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function() {
    overlay.style.display = 'none';
  });

  // Attach click handlers to gallery images
  document.addEventListener('click', function(e) {
    var img = e.target.closest('.gallery-grid__item img');
    if (img) {
      document.getElementById('lightboxImg').src = img.src;
      overlay.style.display = 'flex';
    }
  });
}
