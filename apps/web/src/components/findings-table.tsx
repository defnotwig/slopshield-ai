'use client';

import React, { useState } from 'react';
import { SeverityBadge } from '@/components/severity-badge';
import { Search, Eye } from 'lucide-react';

interface Finding {
  id: string;
  filePath: string | null;
  lineNumber: number | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  blocking: boolean;
  source: string;
}

interface FindingsTableProps {
  findings: Finding[];
  onSelectFinding: (finding: Finding) => void;
}

export function FindingsTable({ findings, onSelectFinding }: FindingsTableProps) {
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const severities = ['all', 'critical', 'high', 'medium', 'low', 'info'];
  const categories = [
    'all',
    'security',
    'maintainability',
    'architecture',
    'testability',
    'frontend',
    'backend',
  ];

  // Filtering logic
  const filteredFindings = findings.filter((f) => {
    const matchesSeverity = filterSeverity === 'all' || f.severity.toLowerCase() === filterSeverity;
    const matchesCategory =
      filterCategory === 'all' || f.category.toLowerCase().includes(filterCategory);
    
    const searchText = `${f.title} ${f.filePath || ''} ${f.description || ''}`.toLowerCase();
    const matchesSearch = searchText.includes(searchQuery.toLowerCase());

    return matchesSeverity && matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Filters Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-sm">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search findings title or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-4 items-center w-full md:w-auto">
          {/* Severity Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Severity</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring capitalize"
            >
              {severities.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Category</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring capitalize"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Findings Table */}
      <div className="border border-border rounded-sm overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                <th className="px-6 py-3.5">Severity</th>
                <th className="px-6 py-3.5">Category</th>
                <th className="px-6 py-3.5">Finding Details</th>
                <th className="px-6 py-3.5">File & Location</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm text-foreground">
              {filteredFindings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground font-medium">
                    No findings matches the active filter criteria. Clear filters to see all.
                  </td>
                </tr>
              ) : (
                filteredFindings.map((finding) => (
                  <tr 
                    key={finding.id} 
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <SeverityBadge severity={finding.severity} />
                      {finding.blocking && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-none text-[9px] font-mono font-bold bg-status-blocked/10 text-status-blocked border border-status-blocked">
                          BLOCKER
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap capitalize text-xs font-semibold tracking-wide">
                      {finding.category}
                    </td>
                    <td className="px-6 py-4.5">
                      <p className="font-semibold text-foreground">{finding.title}</p>
                      {finding.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {finding.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4.5 font-mono text-xs text-muted-foreground">
                      {finding.filePath ? (
                        <span>
                          {finding.filePath}
                          {finding.lineNumber ? `:${finding.lineNumber}` : ''}
                        </span>
                      ) : (
                        <span className="italic">Project-wide</span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => onSelectFinding(finding)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
