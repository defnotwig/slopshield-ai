import React from 'react';

interface CategoryScoresProps {
  scores: {
    security: number;
    maintainability: number;
    architecture: number;
    testability: number;
    frontend: number;
    backend: number;
  };
}

export function CategoryScores({ scores }: CategoryScoresProps) {
  const categories = [
    { name: 'Security', value: scores.security, weight: '25%', color: 'var(--color-severity-critical, #ef4444)' },
    { name: 'Maintainability', value: scores.maintainability, weight: '20%', color: 'var(--color-severity-high, #f97316)' },
    { name: 'Architecture', value: scores.architecture, weight: '20%', color: 'var(--color-severity-medium, #f59e0b)' },
    { name: 'Testability', value: scores.testability, weight: '15%', color: 'var(--color-severity-low, #3b82f6)' },
    { name: 'Frontend UX/A11y', value: scores.frontend, weight: '10%', color: 'var(--color-primary, #06b6d4)' },
    { name: 'Backend Reliability', value: scores.backend, weight: '10%', color: 'var(--color-chart-5, #8b5cf6)' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {categories.map((cat) => {
        const val = cat.value ?? 100;
        return (
          <div key={cat.name} className="border border-border bg-card p-5 rounded-sm">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="font-semibold text-foreground text-sm tracking-wide">
                  {cat.name}
                </h3>
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Weight: {cat.weight}
                </span>
              </div>
              <span 
                className="font-display text-2xl font-bold" 
                style={{ color: val >= 80 ? 'var(--color-status-passed)' : val >= 60 ? 'var(--color-status-warning)' : 'var(--color-status-blocked)' }}
              >
                {val}/100
              </span>
            </div>

            {/* Progress Bar Container */}
            <div className="h-1.5 w-full bg-muted border border-border rounded-none overflow-hidden">
              <div 
                className="h-full rounded-none transition-all duration-1000 ease-out"
                style={{ 
                  width: `${val}%`,
                  backgroundColor: cat.color
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
