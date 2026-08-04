import { useMemo, useState } from 'react';
import { featuredTemplates, tripTemplates } from '../tripTemplates';

const MODE_LABELS = {
  car: 'Car',
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
};

function Stars({ rating }) {
  const filled = Math.round(rating);
  return (
    <span className="template-rating" aria-label={`${rating} out of 5 Wander match`}>
      <span>{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span>
      <b>{rating}</b>
      <small>Wander match</small>
    </span>
  );
}

function TemplateCard({ template, onSelect }) {
  return (
    <article className="template-card">
      <div className="template-image-wrap">
        <img
          src={template.image}
          alt={`${template.city}, ${template.country}`}
          loading="lazy"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
        <span>{template.theme}</span>
        <a href="https://unsplash.com" target="_blank" rel="noreferrer">Photo: {template.photoCredit}</a>
      </div>
      <div className="template-content">
        <div className="template-title-row">
          <div>
            <small>
              {[template.region, template.country].filter(Boolean).join(', ')} · {template.duration}
            </small>
            <h3>{template.title}</h3>
          </div>
          <Stars rating={template.rating} />
        </div>
        <p>{template.description}</p>
        <div className="template-highlights">
          <b>Top pick: {template.topPick}</b>
          <span>{template.places.slice(1, 4).join(' · ')}</span>
        </div>
        <div className="transport-advice">
          <span className="transport-primary">Travel options depend on your starting point</span>
        </div>
        <small className="transport-reason">
          Choose this trip and enter where you are starting. Wander will block impossible routes and recommend the practical way to arrive.
        </small>
        <button onClick={() => onSelect(template)}>Use this template</button>
      </div>
    </article>
  );
}

export default function TemplateBrowser({ onSelect }) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return tripTemplates;
    return tripTemplates.filter((template) => [
      template.title,
      template.city,
      template.country,
      template.region,
      template.theme,
      template.description,
      template.modes.join(' '),
    ].join(' ').toLowerCase().includes(text));
  }, [query]);
  const visible = showAll ? filtered : featuredTemplates;

  return (
    <section className="template-browser">
      <div className="template-heading">
        <div>
          <span>Start with an idea</span>
          <h2>Recommended trip templates</h2>
          <p>Choose a destination plan, then add your origin, travel date, time, and preferred transportation.</p>
        </div>
        <button className="ghost" onClick={() => { setShowAll(!showAll); setQuery(''); }}>
          {showAll ? 'Close extra trips' : 'See all'}
        </button>
      </div>
      {showAll && (
        <div className="template-search">
          <span>⌕</span>
          <input
            value={query}
            placeholder="Search a city, country, island, or transportation type…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      <div className="template-list">
        {visible.map((template) => (
          <TemplateCard key={template.id} template={template} onSelect={onSelect} />
        ))}
      </div>
      {showAll && visible.length === 0 && (
        <div className="template-empty">
          <div className="sleepy-bot"><span>•﹏•</span><i /></div>
          <div className="empty-letter">?</div>
          <h3>I couldn’t find that template.</h3>
          <p>Try a destination, transportation type, or travel style.</p>
        </div>
      )}
    </section>
  );
}
