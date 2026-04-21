import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  Line,
  Area,
  ComposedChart
} from 'recharts';

interface InvestmentChartData {
  month: string;
  total: number;
  amount: number;
  benchmark?: number;
}

interface InvestmentChartProps {
  data: InvestmentChartData[];
}

interface DonutChartProps {
  data: { name: string; value: number; color: string }[];
}

export const InvestmentDonutChart = ({ data }: DonutChartProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    // Initial size measurement
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }

    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setSize((prev) => {
          const nextWidth = Math.floor(width);
          const nextHeight = Math.floor(height);
          if (Math.abs(prev.width - nextWidth) < 2 && Math.abs(prev.height - nextHeight) < 2) {
            return prev;
          }
          return { width: nextWidth, height: nextHeight };
        });
      }
    });

    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center text-white/20 text-xs font-bold uppercase tracking-widest border border-white/5 bg-white/5 rounded-3xl">
        Sem dados para exibir
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-[200px] relative overflow-hidden flex items-center justify-center">
      {size.width > 0 && size.height > 0 && (
        <PieChart width={size.width} height={size.height}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={Math.min(size.width, size.height) * 0.3}
            outerRadius={Math.min(size.width, size.height) * 0.45}
            paddingAngle={5}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'rgba(18, 18, 18, 0.95)', 
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              fontSize: '12px',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
            }}
            itemStyle={{ color: '#fff' }}
            formatter={(val: number) => [`R$ ${val.toLocaleString('pt-BR')}`, 'Valor']}
          />
        </PieChart>
      )}
    </div>
  );
};

export const InvestmentMonthlyChart = ({ data }: InvestmentChartProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    // Initial size measurement
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }

    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setSize((prev) => {
          const nextWidth = Math.floor(width);
          const nextHeight = Math.floor(height);
          if (Math.abs(prev.width - nextWidth) < 2 && Math.abs(prev.height - nextHeight) < 2) {
            return prev;
          }
          return { width: nextWidth, height: nextHeight };
        });
      }
    });

    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center text-white/20 text-xs font-bold uppercase tracking-widest border border-white/5 bg-white/5 rounded-3xl">
        Sem histórico disponível
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-[300px] relative overflow-hidden">
      {size.width > 0 && size.height > 0 && (
        <ComposedChart width={size.width} height={size.height} data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00E676" stopOpacity={0.1}/>
              <stop offset="95%" stopColor="#00E676" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
          <XAxis 
            dataKey="month" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 'bold' }} 
            dy={10}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} 
          />
          <Tooltip 
            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            contentStyle={{ 
              backgroundColor: 'rgba(18, 18, 18, 0.95)', 
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              fontSize: '12px',
              color: '#fff',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
            }}
          />
          <Area 
            type="monotone" 
            dataKey="total" 
            fillOpacity={1} 
            fill="url(#colorTotal)" 
            stroke="none"
          />
          <Bar 
            dataKey="amount" 
            name="Aporte"
            radius={[4, 4, 0, 0]} 
            barSize={Math.min(size.width / (data.length || 1) * 0.3, 16)}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={index === data.length - 1 ? '#00E676' : 'rgba(0, 230, 118, 0.3)'} 
              />
            ))}
          </Bar>
          <Line 
            type="monotone" 
            dataKey="total" 
            name="Patrimônio"
            stroke="#00E676" 
            strokeWidth={3}
            dot={{ r: 4, fill: '#00E676', strokeWidth: 2, stroke: '#121212' }}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
          <Line 
            type="monotone" 
            dataKey="benchmark" 
            name="Benchmark (CDI)"
            stroke="rgba(255,255,255,0.2)" 
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
          />
        </ComposedChart>
      )}
    </div>
  );
};
