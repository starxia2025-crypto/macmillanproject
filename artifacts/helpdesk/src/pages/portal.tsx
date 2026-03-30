import { useState } from "react";
import { useListDocuments, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Book, Video, HelpCircle, Link as LinkIcon, FileText, FileDown } from "lucide-react";
import { format } from "date-fns";

export default function Portal() {
  const { data: user } = useGetMe();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const { data: docsData, isLoading } = useListDocuments({
    tenantId: user?.role === 'superadmin' ? undefined : user?.tenantId,
    search: search || undefined,
    category: activeCategory !== 'all' ? activeCategory : undefined,
    limit: 50
  });

  const getIcon = (type: string) => {
    switch(type) {
      case 'video': return <Video className="h-8 w-8 text-rose-500" />;
      case 'faq': return <HelpCircle className="h-8 w-8 text-amber-500" />;
      case 'link': return <LinkIcon className="h-8 w-8 text-sky-500" />;
      case 'manual': return <Book className="h-8 w-8 text-indigo-500" />;
      case 'tutorial': return <FileText className="h-8 w-8 text-emerald-500" />;
      default: return <FileDown className="h-8 w-8 text-slate-500" />;
    }
  };

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Derive categories from data
  const categories = ['all', ...Array.from(new Set(docsData?.data.map(d => d.category).filter(Boolean) as string[]))];

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-primary text-primary-foreground rounded-2xl p-8 md:p-12 relative overflow-hidden shadow-lg">
        <div className="absolute inset-0 z-0 opacity-10">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid-portal" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-portal)" />
          </svg>
        </div>
        
        <div className="relative z-10 max-w-2xl mx-auto text-center space-y-6">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">How can we help?</h1>
          <p className="text-primary-foreground/80 text-lg">Search our knowledge base for manuals, video tutorials, and answers to common questions.</p>
          
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input 
              className="h-14 pl-12 text-lg rounded-full bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-white/30 shadow-inner"
              placeholder="Search for articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Categories */}
        <div className="w-full md:w-64 shrink-0 space-y-2">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-slate-500 mb-4 px-3">Categories</h3>
          <div className="flex md:flex-col flex-wrap gap-1">
            {categories.map(cat => (
              <Button 
                key={cat}
                variant={activeCategory === cat ? "secondary" : "ghost"} 
                className={`justify-start capitalize ${activeCategory === cat ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Content Grid */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />)}
            </div>
          ) : docsData?.data.length === 0 ? (
            <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed">
              <HelpCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No articles found</h3>
              <p className="text-slate-500">We couldn't find anything matching your search criteria.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {docsData?.data.map((doc) => (
                <a 
                  key={doc.id} 
                  href={doc.url || '#'} 
                  target={doc.url ? "_blank" : undefined}
                  rel={doc.url ? "noopener noreferrer" : undefined}
                  className="block group"
                >
                  <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all duration-200 bg-white dark:bg-slate-900">
                    <CardContent className="p-5 flex gap-4">
                      <div className="shrink-0 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg group-hover:bg-primary/5 transition-colors">
                        {getIcon(doc.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-[10px] h-5 font-medium px-1.5 uppercase tracking-wider">
                            {getTypeLabel(doc.type)}
                          </Badge>
                          {doc.category && <span className="text-xs text-slate-400 capitalize">{doc.category}</span>}
                        </div>
                        <h3 className="font-semibold text-slate-900 dark:text-white leading-tight group-hover:text-primary transition-colors line-clamp-2">
                          {doc.title}
                        </h3>
                        {doc.description && (
                          <p className="text-sm text-slate-500 mt-1 line-clamp-2">{doc.description}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
