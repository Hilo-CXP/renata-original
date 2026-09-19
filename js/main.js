document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('header');
  const menuToggle = document.getElementById('menuToggle');
  const nav = document.getElementById('nav');
  const scrollTopBtn = document.getElementById('scrollTop');
  const contactForm = document.getElementById('contactForm');
  const formFeedback = document.getElementById('formFeedback');

  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  });

  menuToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuToggle.classList.toggle('active');
    menuToggle.setAttribute('aria-expanded', isOpen);
  });

  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuToggle.classList.remove('active');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });

  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    formFeedback.className = 'form-feedback';

    const nome = contactForm.nome.value.trim();
    const email = contactForm.email.value.trim();
    const mensagem = contactForm.mensagem.value.trim();

    if (!nome || !email || !mensagem) {
      formFeedback.textContent = 'Por favor, preencha todos os campos obrigatórios.';
      formFeedback.classList.add('error');
      return;
    }

    formFeedback.textContent = 'Mensagem enviada com sucesso! Retorno em até 24 horas.';
    formFeedback.classList.add('success');
    contactForm.reset();

    setTimeout(() => {
      formFeedback.textContent = '';
      formFeedback.className = 'form-feedback';
    }, 5000);
  });

  /* Google reviews carousel */
  const carousel = document.querySelector('[data-reviews-carousel]');
  if (carousel) {
    const track = carousel.querySelector('[data-reviews-track]');
    const prevBtn = carousel.querySelector('[data-reviews-prev]');
    const nextBtn = carousel.querySelector('[data-reviews-next]');
    const cards = Array.from(track.children);
    let index = 0;

    const getPerView = () => {
      if (window.innerWidth <= 768) return 1;
      if (window.innerWidth <= 1024) return 2;
      if (window.innerWidth <= 1100) return 3;
      return 4;
    };

    const update = () => {
      const perView = getPerView();
      const maxIndex = Math.max(0, cards.length - perView);
      if (index > maxIndex) index = maxIndex;

      const cardWidth = cards[0].getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      track.style.transform = `translateX(-${index * (cardWidth + gap)}px)`;

      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= maxIndex;
    };

    prevBtn.addEventListener('click', () => {
      index = Math.max(0, index - 1);
      update();
    });

    nextBtn.addEventListener('click', () => {
      const perView = getPerView();
      const maxIndex = Math.max(0, cards.length - perView);
      index = Math.min(maxIndex, index + 1);
      update();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(update, 120);
    });

    update();
  }
});
