"""
اختبار الإضافة في متصفح كروم حقيقي
يفتح صفحة الحالات الصعبة ويتأكد من النتيجة ويحفظ صور قبل وبعد

التشغيل:
  python3 test/run.py
"""

import http.server
import os
import socketserver
import sys
import tempfile
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'extension')
SHOTS = os.path.join(ROOT, 'test', 'shots')
CHROME = os.environ.get('CHROME', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
PORT = 8765

results = []


def check(name, ok, detail=''):
    results.append((name, ok))
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else '  ' + str(detail)))


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=os.path.join(ROOT, 'test'), **k)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def attr(page, sel, name):
    return page.eval_on_selector(sel, f'e => e.getAttribute("{name}")')


def direction(page, sel):
    return page.eval_on_selector(sel, 'e => getComputedStyle(e).direction')


def main():
    os.makedirs(SHOTS, exist_ok=True)
    httpd = serve()
    url = f'http://127.0.0.1:{PORT}/cases.html'

    with sync_playwright() as p:
        # صورة قبل بدون الإضافة
        b = p.chromium.launch(executable_path=CHROME, args=['--headless=new'])
        pg = b.new_page(viewport={'width': 820, 'height': 1500})
        pg.goto(url)
        pg.evaluate('startStream()')
        pg.wait_for_function('window.streamDone === true')
        pg.screenshot(path=os.path.join(SHOTS, 'before.png'), full_page=True)
        b.close()

        profile = tempfile.mkdtemp()
        ctx = p.chromium.launch_persistent_context(
            profile,
            executable_path=CHROME,
            headless=False,
            args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'],
            viewport={'width': 820, 'height': 1500},
        )

        # صفحة الترحيب تفتح لحالها بعد التثبيت
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        time.sleep(1)
        opened = sw.evaluate('clients.matchAll({ type: "window", includeUncontrolled: true }).then(c => c.map(x => x.url))')
        check('صفحة الترحيب تفتح بعد التثبيت', any('welcome' in u for u in opened), opened)

        page = ctx.new_page()
        page.goto(url)
        page.wait_for_timeout(400)

        check('فقرة عربية تصير من اليمين', direction(page, '#p-ar') == 'rtl')
        check('محاذاة يسار ثابتة تنقلب يمين', page.eval_on_selector('#p-ar', 'e => getComputedStyle(e).textAlign') == 'right')
        check('فقرة تبدأ بالإنجليزي وأغلبها عربي تصير من اليمين', direction(page, '#p-mixed') == 'rtl')
        check('فقرة إنجليزية فيها كلمة عربية تبقى من اليسار', direction(page, '#p-en') == 'ltr' and attr(page, '#p-en', 'data-rtle') is None)
        check('القائمة تنقلب والأرقام يمين', direction(page, '#list') == 'rtl')
        pad = page.eval_on_selector('#list', 'e => [getComputedStyle(e).paddingRight, getComputedStyle(e).paddingLeft]')
        check('مسافة القائمة تنتقل لليمين', pad[0] == '26px' and pad[1] == '0px', pad)
        check('العنصر الإنجليزي داخل القائمة يبقى من اليسار',
              page.eval_on_selector('#list li:nth-child(3)', 'e => getComputedStyle(e).unicodeBidi') == 'plaintext')
        check('الجدول ينقلب', direction(page, '#table') == 'rtl')
        check('الشيفرة البرمجية تبقى من اليسار', direction(page, '#code') == 'ltr' and attr(page, '#code', 'data-rtle') is None)
        check('الموقع العربي ما ينلمس', attr(page, '#p-native', 'data-rtle') is None and attr(page, '#native', 'data-rtle') is None)

        # الرد اللي ينكتب حرف حرف
        page.evaluate('startStream()')
        page.wait_for_function('window.streamDone === true')
        page.wait_for_timeout(400)
        check('الرد اللي ينكتب تدريجيا ينضبط', direction(page, '#stream') == 'rtl')

        # مربع كتابة عادي
        page.click('#ta')
        page.keyboard.type('مرحبا هذا اختبار')
        check('مربع الكتابة يصير من اليمين', direction(page, '#ta') == 'rtl')
        page.fill('#ta', '')
        page.keyboard.type('hello there')
        check('مربع الكتابة يرجع يسار مع الإنجليزي', direction(page, '#ta') == 'ltr')

        # محرر بريد عادي: الاتجاه ينكتب داخل الرسالة
        page.click('#mail-p')
        page.keyboard.type('السلام عليكم ورحمة الله')
        page.wait_for_timeout(200)
        html = page.eval_on_selector('#mail', 'e => e.innerHTML')
        check('محرر البريد يحفظ الاتجاه داخل الرسالة', 'dir="rtl"' in html, html)

        # محرر مبني بمكتبة: ما نعدل عناصره
        page.click('#pm-p')
        page.keyboard.type('ساعدني أكتب رسالة شكر')
        page.wait_for_timeout(200)
        check('محرر المكتبات ما تتعدل عناصره', attr(page, '#pm-p', 'dir') is None)
        check('محرر المكتبات كل سطر ياخذ اتجاهه',
              page.eval_on_selector('#pm-p', 'e => getComputedStyle(e).unicodeBidi') == 'plaintext')

        # محرر داخل إطار
        frame = page.frame_locator('#frame')
        frame.locator('#fp').click()
        page.keyboard.type('رسالة من داخل الإطار')
        page.wait_for_timeout(200)
        fhtml = page.frames[1].evaluate('document.body.innerHTML')
        check('محرر داخل إطار يحفظ الاتجاه', 'dir="rtl"' in fhtml, fhtml)


        # محرر يبني إطاره بعد ما تبدأ الإضافة مثل بريد هوستنقر
        page.wait_for_timeout(3200)
        f2 = page.frame_locator('#frame2')
        f2.locator('#lp').click()
        page.keyboard.type('عندي مشكلة في موقع jameyathadaya.com شهادة SSL منتهية')
        page.wait_for_timeout(300)
        f2doc = [fr for fr in page.frames if fr.name == '' and fr != page.main_frame]
        lp_dir = page.evaluate("document.getElementById('frame2').contentDocument.getElementById('lp').getAttribute('dir')")
        check('محرر يبني إطاره متأخر يحفظ الاتجاه', lp_dir == 'rtl', lp_dir)

        # إطار مكتوب في الصفحة نفسها
        page.frame_locator('#frame3').locator('#sp').click()
        page.keyboard.type('رسالة من إطار مكتوب في الصفحة')
        page.wait_for_timeout(300)
        sp_dir = page.evaluate("document.getElementById('frame3').contentDocument.getElementById('sp').getAttribute('dir')")
        check('إطار مكتوب في الصفحة يحفظ الاتجاه', sp_dir == 'rtl', sp_dir)

        # محرر داخل مكون مغلق
        page.click('#shadow-host')
        page.keyboard.type('مرحبا من داخل المكون')
        page.wait_for_timeout(300)
        sh_dir = page.evaluate("document.getElementById('shadow-host').shadowRoot.getElementById('sh-p').getAttribute('dir')")
        check('محرر داخل مكون مغلق يحفظ الاتجاه', sh_dir == 'rtl', sh_dir)

        # شريط نافذة فيه عنوان عربي وأزرار
        tb = page.evaluate("[getComputedStyle(document.getElementById('titlebar')).direction, document.getElementById('close').getBoundingClientRect().left < 100]")
        check('شريط النافذة ما تنقلب أزراره', tb[0] == 'ltr' and tb[1], tb)

        # الرد ينضبط قبل ما يرسمه المتصفح
        before_paint = page.evaluate("""async () => {
            const p = document.getElementById('live-p');
            p.textContent = 'هذا رد عربي جديد';
            await null;
            return p.getAttribute('dir');
        }""")
        check('الرد ينضبط من أول حرف بدون تأخير', before_paint == 'rtl', before_paint)

        page.screenshot(path=os.path.join(SHOTS, 'after.png'), full_page=True)

        # زر الإيقاف يرجع الصفحة مثل ما كانت
        sw.evaluate('chrome.storage.local.set({ off: ["127.0.0.1"] })')
        page.wait_for_timeout(400)
        left = page.evaluate('document.querySelectorAll("[data-rtle]").length')
        check('الإيقاف يرجع الصفحة مثل ما كانت', left == 0 and direction(page, '#p-ar') == 'ltr', left)
        sw.evaluate('chrome.storage.local.set({ off: [] })')
        page.wait_for_timeout(400)
        check('التشغيل مرة ثانية يرجع الضبط', direction(page, '#p-ar') == 'rtl')

        # سرعة: محادثة طويلة فيها ألفين رسالة
        page.goto(url)
        ms = page.evaluate('''() => {
            const box = document.querySelector('#chat .markdown');
            const t0 = performance.now();
            for (let i = 0; i < 2000; i++) {
                const p = document.createElement('p');
                p.textContent = i % 3 ? 'رسالة عربية رقم ' + i + ' فيها كلام عادي' : 'English message number ' + i;
                box.appendChild(p);
            }
            return new Promise(r => setTimeout(() => r(performance.now() - t0), 600));
        }''')
        marked = page.evaluate('document.querySelectorAll("#chat p[data-rtle=rtl]").length')
        check('ألفين رسالة تنضبط بدون ما تثقل', marked >= 1333, f'{marked} in {ms:.0f}ms')
        print(f'      الوقت مع الانتظار {ms:.0f} مللي ثانية')

        # الواجهات
        pop = ctx.new_page()
        pop.set_viewport_size({'width': 300, 'height': 330})
        pop.goto(f'chrome-extension://{ext_id}/popup/popup.html?url=https://chatgpt.com/c/1')
        pop.wait_for_timeout(500)
        pop.screenshot(path=os.path.join(SHOTS, 'popup.png'))
        pop.click('.switch')
        pop.wait_for_timeout(300)
        off = sw.evaluate('chrome.storage.local.get({ off: [] }).then(v => v.off)')
        check('زر الإيقاف في النافذة يوقف الموقع', off == ['chatgpt.com'], off)
        pop.screenshot(path=os.path.join(SHOTS, 'popup-off.png'))
        pop.goto(f'chrome-extension://{ext_id}/popup/popup.html?url=chrome://settings')
        pop.wait_for_timeout(300)
        pop.screenshot(path=os.path.join(SHOTS, 'popup-internal.png'))

        w = ctx.new_page()
        w.set_viewport_size({'width': 1100, 'height': 900})
        w.goto(f'chrome-extension://{ext_id}/welcome/welcome.html')
        w.wait_for_timeout(600)
        w.screenshot(path=os.path.join(SHOTS, 'welcome.png'), full_page=True)
        w.set_viewport_size({'width': 390, 'height': 800})
        w.wait_for_timeout(300)
        w.screenshot(path=os.path.join(SHOTS, 'welcome-mobile.png'), full_page=True)

        ctx.close()

    httpd.shutdown()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)} من {len(results)} نجحت')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
