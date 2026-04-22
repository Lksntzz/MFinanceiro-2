
export interface PaymentAlias {
  key: string;
  displayName: string;
  officialName: string;
  aliases: string[];
  keywords?: string[];
  state?: string;
  region?: string;
  notes?: string;
}

export interface PaymentCategoryBase {
  [category: string]: PaymentAlias[];
}

export const PAYMENT_ALIASES: PaymentCategoryBase = {
  internet_telefonia: [
    {
      key: 'claro',
      displayName: 'Claro',
      officialName: 'Claro S.A.',
      aliases: ['claro', 'net', 'embratel', 'claro s/a', 'net servicos'],
      keywords: ['fatura claro', 'fatura net', 'embratel fatura', 'claro sa']
    },
    {
      key: 'vivo',
      displayName: 'Vivo',
      officialName: 'Telefônica Brasil S.A.',
      aliases: ['vivo', 'telefonica', 'telefonica brasil', 'vivo fibra', 'vivo movel'],
      keywords: ['viva fibra', 'fatura vivo', 'telefonica fatura']
    },
    {
      key: 'tim',
      displayName: 'TIM',
      officialName: 'TIM S/A',
      aliases: ['tim', 'tim brasil', 'tim celular'],
      keywords: ['fatura tim', 'tim s/a']
    },
    {
      key: 'oi',
      displayName: 'Oi',
      officialName: 'Oi S.A.',
      aliases: ['oi', 'oi s.a.', 'oi fixo', 'oi fibra', 'nio fibra'],
      keywords: ['fatura oi', 'oi fibra pagto']
    },
    {
      key: 'algar',
      displayName: 'Algar',
      officialName: 'Algar Telecom',
      aliases: ['algar', 'algar telecom'],
      keywords: ['fatura algar']
    },
    {
      key: 'sercomtel',
      displayName: 'Sercomtel',
      officialName: 'Sercomtel S.A. Telecomunicações',
      aliases: ['sercomtel'],
      keywords: ['fatura sercomtel']
    },
    {
      key: 'brisanet',
      displayName: 'Brisanet',
      officialName: 'Brisanet Serviços de Telecomunicações',
      aliases: ['brisanet'],
      keywords: ['brisanet fatura']
    }
  ],
  agua_saneamento: [
    {
      key: 'sabesp',
      displayName: 'Sabesp',
      officialName: 'Companhia de Saneamento Básico do Estado de São Paulo',
      aliases: ['sabesp', 'cia saneamento basico', 'estade sao paulo'],
      keywords: ['conta agua sabesp', 'sabesp sp'],
      state: 'SP'
    },
    {
      key: 'caesb',
      displayName: 'Caesb',
      officialName: 'Companhia de Saneamento Ambiental do Distrito Federal',
      aliases: ['caesb'],
      state: 'DF'
    },
    {
      key: 'copasa',
      displayName: 'Copasa',
      officialName: 'Companhia de Saneamento de Minas Gerais',
      aliases: ['copasa'],
      state: 'MG'
    },
    {
      key: 'sanepar',
      displayName: 'Sanepar',
      officialName: 'Companhia de Saneamento do Paraná',
      aliases: ['sanepar'],
      state: 'PR'
    },
    {
      key: 'saneago',
      displayName: 'Saneago',
      officialName: 'Saneamento de Goiás S/A',
      aliases: ['saneago'],
      state: 'GO'
    },
    {
      key: 'cagece',
      displayName: 'Cagece',
      officialName: 'Companhia de Água e Esgoto do Ceará',
      aliases: ['cagece'],
      state: 'CE'
    },
    {
      key: 'cagepa',
      displayName: 'Cagepa',
      officialName: 'Companhia de Água e Esgotos da Paraíba',
      aliases: ['cagepa'],
      state: 'PB'
    },
    {
      key: 'embasa',
      displayName: 'Embasa',
      officialName: 'Empresa Baiana de Águas e Saneamento',
      aliases: ['embasa'],
      state: 'BA'
    },
    {
      key: 'compesa',
      displayName: 'Compesa',
      officialName: 'Companhia Pernambucana de Saneamento',
      aliases: ['compesa'],
      state: 'PE'
    },
    {
      key: 'cedae',
      displayName: 'Cedae',
      officialName: 'Companhia Estadual de Águas e Esgotos do Rio de Janeiro',
      aliases: ['cedae'],
      state: 'RJ'
    },
    {
      key: 'corsan',
      displayName: 'Corsan',
      officialName: 'Companhia Riograndense de Saneamento',
      aliases: ['corsan'],
      state: 'RS'
    },
    {
      key: 'casan',
      displayName: 'Casan',
      officialName: 'Companhia Catarinense de Águas e Saneamento',
      aliases: ['casan'],
      state: 'SC'
    },
    {
      key: 'cesan',
      displayName: 'Cesan',
      officialName: 'Companhia Espírito-santense de Saneamento',
      aliases: ['cesan'],
      state: 'ES'
    },
    {
      key: 'caema',
      displayName: 'Caema',
      officialName: 'Companhia de Saneamento Ambiental do Maranhão',
      aliases: ['caema'],
      state: 'MA'
    },
    {
      key: 'caern',
      displayName: 'Caern',
      officialName: 'Companhia de Águas e Esgotos do Rio Grande do Norte',
      aliases: ['caern'],
      state: 'RN'
    },
    {
      key: 'agespisa',
      displayName: 'Agespisa',
      officialName: 'Águas e Esgotos do Piauí',
      aliases: ['agespisa'],
      state: 'PI'
    },
    {
      key: 'caer',
      displayName: 'Caer',
      officialName: 'Companhia de Águas e Esgotos de Roraima',
      aliases: ['caer'],
      state: 'RR'
    },
    {
      key: 'caerd',
      displayName: 'Caerd',
      officialName: 'Companhia de Águas e Esgotos de Rondônia',
      aliases: ['caerd'],
      state: 'RO'
    },
    {
      key: 'sanesul',
      displayName: 'Sanesul',
      officialName: 'Empresa de Saneamento de Mato Grosso do Sul',
      aliases: ['sanesul'],
      state: 'MS'
    },
    {
      key: 'cosanpa',
      displayName: 'Cosanpa',
      officialName: 'Companhia de Saneamento do Pará',
      aliases: ['cosanpa'],
      state: 'PA'
    }
  ],
  energia_eletrica: [
    {
      key: 'enel_sp',
      displayName: 'Enel São Paulo',
      officialName: 'Enel Distribuição São Paulo',
      aliases: ['enel', 'eletropaulo', 'enel sp'],
      keywords: ['conta luz enel', 'luz sp'],
      state: 'SP'
    },
    {
      key: 'enel_rio',
      displayName: 'Enel Rio',
      officialName: 'Enel Distribuição Rio',
      aliases: ['enel rio', 'ampla'],
      state: 'RJ'
    },
    {
      key: 'enel_ce',
      displayName: 'Enel Ceará',
      officialName: 'Enel Distribuição Ceará',
      aliases: ['enel ceara', 'coelce'],
      state: 'CE'
    },
    {
      key: 'light',
      displayName: 'Light',
      officialName: 'Light Serviços de Eletricidade S.A.',
      aliases: ['light'],
      state: 'RJ'
    },
    {
      key: 'cemig',
      displayName: 'Cemig',
      officialName: 'Companhia Energética de Minas Gerais',
      aliases: ['cemig'],
      state: 'MG'
    },
    {
      key: 'copel',
      displayName: 'Copel',
      officialName: 'Companhia Paranaense de Energia',
      aliases: ['copel'],
      state: 'PR'
    },
    {
      key: 'celesc',
      displayName: 'Celesc',
      officialName: 'Centrais Elétricas de Santa Catarina',
      aliases: ['celesc'],
      state: 'SC'
    },
    {
      key: 'cpfl_paulista',
      displayName: 'CPFL Paulista',
      officialName: 'Companhia Paulista de Força e Luz',
      aliases: ['cpfl paulista', 'cpfl'],
      state: 'SP'
    },
    {
      key: 'cpfl_piratininga',
      displayName: 'CPFL Piratininga',
      officialName: 'Companhia Piratininga de Força e Luz',
      aliases: ['cpfl piratininga', 'cpfl'],
      state: 'SP'
    },
    {
      key: 'rge',
      displayName: 'RGE',
      officialName: 'RGE Sul Distribuidora de Energia',
      aliases: ['rge', 'rge sul'],
      state: 'RS'
    },
    {
      key: 'neoenergia_coelba',
      displayName: 'Neoenergia Coelba',
      officialName: 'Companhia de Eletricidade do Estado da Bahia',
      aliases: ['coelba', 'neoenergia'],
      state: 'BA'
    },
    {
      key: 'neoenergia_pernambuco',
      displayName: 'Neoenergia Pernambuco',
      officialName: 'Companhia Energética de Pernambuco',
      aliases: ['celpe', 'neoenergia'],
      state: 'PE'
    },
    {
      key: 'neoenergia_cosern',
      displayName: 'Neoenergia Cosern',
      officialName: 'Companhia Energética do Rio Grande do Norte',
      aliases: ['cosern', 'neoenergia'],
      state: 'RN'
    },
    {
      key: 'neoenergia_elektro',
      displayName: 'Neoenergia Elektro',
      officialName: 'Elektro Redes S.A.',
      aliases: ['elektro', 'neoenergia'],
      state: 'SP'
    },
    {
      key: 'equatorial_ma',
      displayName: 'Equatorial Maranhão',
      officialName: 'Equatorial Maranhão Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'MA'
    },
    {
      key: 'equatorial_pa',
      displayName: 'Equatorial Pará',
      officialName: 'Equatorial Pará Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'PA'
    },
    {
      key: 'equatorial_pi',
      displayName: 'Equatorial Piauí',
      officialName: 'Equatorial Piauí Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'PI'
    },
    {
      key: 'equatorial_al',
      displayName: 'Equatorial Alagoas',
      officialName: 'Equatorial Alagoas Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'AL'
    },
    {
      key: 'equatorial_ap',
      displayName: 'Equatorial Amapá',
      officialName: 'Equatorial Amapá Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'AP'
    },
    {
      key: 'equatorial_go',
      displayName: 'Equatorial Goiás',
      officialName: 'Equatorial Goiás Distribuidora de Energia',
      aliases: ['equatorial'],
      state: 'GO'
    },
    {
      key: 'ceee_equatorial',
      displayName: 'CEEE Equatorial',
      officialName: 'Companhia Estadual de Energia Elétrica',
      aliases: ['ceee'],
      state: 'RS'
    }
  ],
  bancos_financeiras: [
    {
      key: 'santander',
      displayName: 'Santander',
      officialName: 'Banco Santander (Brasil) S.A.',
      aliases: ['santander'],
      keywords: ['santander pgto', 'santander fatura']
    },
    {
      key: 'bradesco',
      displayName: 'Bradesco',
      officialName: 'Banco Bradesco S.A.',
      aliases: ['bradesco'],
      keywords: ['bradesco fatura', 'bradesco pgto']
    },
    {
      key: 'itau',
      displayName: 'Itaú',
      officialName: 'Itaú Unibanco S.A.',
      aliases: ['itau', 'itau unibanco'],
      keywords: ['itau fatura', 'pgto itau']
    },
    {
      key: 'caixa',
      displayName: 'Caixa',
      officialName: 'Caixa Econômica Federal',
      aliases: ['caixa', 'cef'],
      keywords: ['caixa pgto']
    },
    {
      key: 'bb',
      displayName: 'Banco do Brasil',
      officialName: 'Banco do Brasil S.A.',
      aliases: ['bb', 'banco brasil'],
      keywords: ['bb pgto', 'doc bb']
    },
    {
      key: 'nubank',
      displayName: 'Nubank',
      officialName: 'Nu Pagamentos',
      aliases: ['nubank', 'nu pagamentos'],
      keywords: ['nubank fatura']
    },
    {
      key: 'inter',
      displayName: 'Inter',
      officialName: 'Banco Inter',
      aliases: ['inter', 'banco inter'],
      keywords: ['inter pgto']
    },
    {
      key: 'c6bank',
      displayName: 'C6 Bank',
      officialName: 'C6 Bank S.A.',
      aliases: ['c6 bank', 'c6bank'],
      keywords: ['c6 fatura']
    },
    {
      key: 'safra',
      displayName: 'Safra',
      officialName: 'Banco Safra S.A.',
      aliases: ['safra'],
      keywords: ['safra pgto']
    },
    {
      key: 'pan',
      displayName: 'Pan',
      officialName: 'Banco Pan S.A.',
      aliases: ['pan', 'banco pan'],
      keywords: ['pan fatura']
    }
  ],
  emprestimos_acordos: [
    {
      key: 'acordo_certo',
      displayName: 'Acordo Certo',
      officialName: 'Acordo Certo S.A.',
      aliases: ['acordo certo'],
      keywords: ['pagamento acordo']
    },
    {
      key: 'pagamento_facil',
      displayName: 'Pagamento Fácil',
      officialName: 'Pagamento Fácil',
      aliases: ['pagamento facil'],
      keywords: ['pgto facil']
    },
    {
      key: 'recovery',
      displayName: 'Recovery',
      officialName: 'Recovery do Brasil',
      aliases: ['recovery'],
      keywords: ['pagamento recovery']
    },
    {
      key: 'paschoalotto',
      displayName: 'Paschoalotto',
      officialName: 'Paschoalotto',
      aliases: ['paschoalotto'],
      keywords: ['pagamento paschoalotto']
    }
  ]
};

export const PAYMENT_MARKERS = [
  'pagamento', 'pagto', 'fatura', 'boleto', 'codigo de barras', 'pix', 'qr pix',
  'debito automatico', 'débito automático', 'quitacao', 'quitação', 'parcela',
  'parcelamento', 'acordo', 'renegociacao', 'renegociação', 'liquidacao',
  'liquidação', 'cobranca', 'cobrança'
];
