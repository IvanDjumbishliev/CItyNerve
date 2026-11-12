import React from 'react';
import { HAZARD_MODULES } from './data.js';

const ANALYSIS_TABS = [
  ['map', 'Map'],
  ['register', 'Risk register'],
  ['sources', 'Data & model'],
];

export default function ModuleTabs({ module, route, onNavigate }) {
  const activeModule = typeof module === 'string'
    ? HAZARD_MODULES.find((item) => item.id === module)
    : module;
  if (!activeModule) return null;

  const live = route === activeModule.routes.live;
  const activeTab = ANALYSIS_TABS.find(([key]) => activeModule.routes[key] === route)?.[0];
  return (
    <nav className="module-tabs" aria-label={`${activeModule.name} views`}>
      <div className="module-mode" role="group" aria-label="View mode">
        <button
          type="button"
          className={!live ? 'is-active' : ''}
          aria-pressed={!live}
          onClick={() => onNavigate(activeTab ? route : activeModule.routes.map)}
        >
          Analysis
        </button>
        <button
          type="button"
          className={live ? 'is-active' : ''}
          aria-pressed={live}
          onClick={() => onNavigate(activeModule.routes.live)}
        >
          Live
        </button>
      </div>
      <span className="module-tabs-divider" aria-hidden="true" />
      {ANALYSIS_TABS.map(([key, label]) => (
        <button
          type="button"
          key={key}
          className={`module-tab ${activeTab === key ? 'is-active' : ''}`}
          aria-current={activeTab === key ? 'page' : undefined}
          onClick={() => onNavigate(activeModule.routes[key])}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
