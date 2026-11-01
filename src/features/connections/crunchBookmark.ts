/**
 * The "Send to Jackal" bookmark. Crunch's site can't be read from Jackal's page (different website, different login),
 * but a bookmark runs inside whatever page it is clicked on. Clicked on members.crunch.com while signed in, it asks
 * Crunch for the same three lists the My Profile page shows and posts them to Jackal with a secret that can only do that.
 * Crunch's password never leaves Crunch's page.
 */
export function crunchBookmarkCode(apiUrl: string, token: string) {
  const source = `(async () => {
  const say = (m) => alert('Jackal: ' + m);
  try {
    if (location.hostname !== 'members.crunch.com') { say('Click this on members.crunch.com after signing in.'); return; }
    const get = async (path) => {
      const r = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(path.split('?')[0] + ' answered ' + r.status);
      return r.json();
    };
    const html = await (await fetch('/members', { credentials: 'include' })).text();
    const id = (html.match(/data-member-id="(\\d+)"/) || [])[1];
    if (!id) { say('Sign in on Crunch first, then click this again.'); return; }
    const goal = Number((html.match(/data-workout-goal="(\\d+)"/) || [])[1]) || null;
    const range = 'start_date=2015-01-01&end_date=' + new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const base = '/api/internal/members/' + id;
    const [checkIns, classes, billing] = await Promise.all([
      get(base + '/checkins'),
      get(base + '/class_history?' + range),
      get(base + '/billing_history?' + range),
    ]);
    let r;
    try {
      r = await fetch(${JSON.stringify(apiUrl)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ${JSON.stringify(token)} },
        body: JSON.stringify({ memberId: id, workoutGoal: goal, checkIns, classes, billing }),
      });
    } catch (e) {
      throw new Error("couldn't reach Jackal. Is it running? If your browser asks to allow access to local devices, choose Allow.");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Jackal answered ' + r.status);
    say('sent ' + j.checkIns + ' check-ins, ' + j.classes + ' classes and ' + j.payments + ' payments.');
  } catch (e) {
    say('could not send. ' + ((e && e.message) || e));
  }
})();`
  // One line, because a bookmark's address can't hold line breaks.
  return 'javascript:' + encodeURIComponent(source.replace(/\n\s*/g, ' '))
}
