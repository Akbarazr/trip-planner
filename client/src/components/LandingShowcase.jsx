const COMMENTS = [
  {
    initials: 'AR',
    role: 'Road trip planner',
    quote: 'I can see the route and every daily stop without jumping between different planning apps.',
  },
  {
    initials: 'JM',
    role: 'Family traveler',
    quote: 'The day-by-day plan makes it much easier to keep everyone on the same schedule.',
  },
  {
    initials: 'SK',
    role: 'Weekend explorer',
    quote: 'Saving the itinerary and viewed maps offline is exactly what I need when service gets spotty.',
  },
];

export default function LandingShowcase() {
  return (
    <section className="landing-showcase" aria-labelledby="showcase-title">
      <div className="showcase-heading">
        <span>Everything in one trip</span>
        <h2 id="showcase-title">See your whole journey before you leave.</h2>
        <p>
          Build one complete itinerary, follow the route, and keep every must-see place organized by day.
        </p>
      </div>

      <div className="app-preview-frame">
        <img
          src="/app-preview.svg"
          alt="Wander trip planner showing a route map and day-by-day itinerary"
        />
      </div>

      <div className="traveler-comments">
        {COMMENTS.map((comment) => (
          <article className="traveler-comment" key={comment.initials}>
            <div className="comment-stars" aria-label="Five stars">★★★★★</div>
            <p>“{comment.quote}”</p>
            <div className="comment-person">
              <span>{comment.initials}</span>
              <div>
                <b>Wander traveler</b>
                <small>{comment.role}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
