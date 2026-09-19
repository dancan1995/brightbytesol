// Shared behaviour for all Bright Byte Solution pages.
(function () {
    var html = document.documentElement;
    if (window.feather) feather.replace();

    var year = document.getElementById('copyright-year');
    if (year) year.textContent = new Date().getFullYear();

    // Theme toggle (the icon shows the theme you would switch to)
    var themeToggle = document.getElementById('theme-toggle');
    function syncThemeIcon() {
        if (!themeToggle) return;
        var dark = html.getAttribute('data-theme') === 'dark';
        themeToggle.innerHTML = '<i data-feather="' + (dark ? 'sun' : 'moon') + '"></i>';
        if (window.feather) feather.replace();
    }
    if (themeToggle) {
        syncThemeIcon();
        themeToggle.addEventListener('click', function () {
            var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) {}
            syncThemeIcon();
        });
    }

    // Mobile menu
    var menuBtn = document.getElementById('mobile-menu-button');
    var links = document.getElementById('nav-links');
    function setMenu(open) {
        links.classList.toggle('is-open', open);
        menuBtn.setAttribute('aria-expanded', String(open));
        menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        menuBtn.innerHTML = '<i data-feather="' + (open ? 'x' : 'menu') + '"></i>';
        if (window.feather) feather.replace();
    }
    if (menuBtn && links) {
        menuBtn.addEventListener('click', function () { setMenu(!links.classList.contains('is-open')); });
        links.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function () { setMenu(false); });
        });
    }

    // Reveal on scroll
    var items = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        items.forEach(function (el) { io.observe(el); });
    } else {
        items.forEach(function (el) { el.classList.add('is-visible'); });
    }

    // Booking page: preselect the service passed in the link (book.html?service=data-analytics)
    var serviceSelect = document.getElementById('a-service');
    if (serviceSelect) {
        var wanted = new URLSearchParams(window.location.search).get('service');
        if (wanted) serviceSelect.value = wanted;
    }
})();
