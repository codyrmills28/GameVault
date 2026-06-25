const fs = require('fs');
const files = [
  'src/components/ModsView.tsx',
  'src/components/BackupsView.tsx',
  'src/components/TeamView.tsx',
  'src/components/AuditLogsView.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  if (!content.includes('Store,')) {
    content = content.replace('Plus,', 'Plus,\n  Store,');
  }

  const linkString = `            <Link 
              href="/dashboard/marketplace" 
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/5 text-slate-300 hover:text-white transition-all group"
            >
              <Store className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
              <span>Marketplace</span>
            </Link>
`;

  if (!content.includes('/dashboard/marketplace')) {
    content = content.replace(
      '<span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">Features</span>',
      linkString + '\n            <div className="pt-4 pb-2 px-3">\n              <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">Features</span>'
    );
  }

  fs.writeFileSync(file, content);
});
