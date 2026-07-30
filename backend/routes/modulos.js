// ─── Rotas de Módulos Add-on ──────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const { criarRecorrencia, cancelarRecorrencia } = require('../services/cielo');

// Catálogo de módulos disponíveis
const MODULOS = {
  painel_gestor: {
    id:          'painel_gestor',
    nome:        'Painel do Gestor',
    descricao:   'Visão completa da equipe: Arena de Vendas, Metas, Ranking de contratos fechados e performance individual de cada vendedor — tudo em um só lugar.',
    emoji:       '🏟️',
    valor_m:     '147.00',
    valor_a:     '117.00',
    rota:        '/gestor',
  },
  calendario_cadencia: {
    id:          'calendario_cadencia',
    nome:        'Calendário e Cadência',
    descricao:   'Agenda comercial, cadência de follow-ups automatizada e lembretes antes de reuniões.',
    emoji:       '📅',
    valor_m:     '97.00',
    valor_a:     '77.00',
    rota:        '/agenda',
  },
  briefing_reuniao: {
    id:          'briefing_reuniao',
    nome:        'Briefing de Reunião',
    descricao:   'Briefing personalizado gerado pela IA antes de cada reunião — histórico do lead, objeções prováveis e script recomendado.',
    emoji:       '📋',
    valor_m:     '47.00',
    valor_a:     '37.00',
    rota:        '/leads',
  },
};

// ─── GET /api/modulos ─────────────────────────────────────────────────────────
// Retorna catálogo + quais estão ativos para a empresa do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('empresa_id, role')
      .eq('id', req.user.id)
      .single();

    const empresa_id = user?.empresa_id;

    let ativos = [];
    if (empresa_id) {
      const { data } = await supabase
        .from('empresa_modulos')
        .select('*')
        .eq('empresa_id', empresa_id);
      ativos = data || [];
    }

    const ativosMap = {};
    ativos.forEach(m => { ativosMap[m.modulo_id] = m; });

    const catalogo = Object.values(MODULOS).map(mod => ({
      ...mod,
      ativo:       !!ativosMap[mod.id],
      periodo:     ativosMap[mod.id]?.periodo || null,
      ativo_desde: ativosMap[mod.id]?.created_at || null,
      cielo_id:    ativosMap[mod.id]?.cielo_recurrent_id || null,
    }));

    res.json({ modulos: catalogo });
  } catch (err) {
    console.error('Erro GET /modulos:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar módulos.' });
  }
});

// ─── GET /api/modulos/check/:moduloId ────────────────────────────────────────
// Verifica se a empresa tem acesso a um módulo específico (usado pelos gates de página)
router.get('/check/:moduloId', authMiddleware, async (req, res) => {
  try {
    const { moduloId } = req.params;

    if (!MODULOS[moduloId]) {
      return res.status(404).json({ acesso: false, erro: 'Módulo não encontrado.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('empresa_id, role')
      .eq('id', req.user.id)
      .single();

    // Admins May sempre têm acesso
    if (user?.role === 'admin_may') return res.json({ acesso: true });

    if (!user?.empresa_id) return res.json({ acesso: false });

    const { data } = await supabase
      .from('empresa_modulos')
      .select('id')
      .eq('empresa_id', user.empresa_id)
      .eq('modulo_id', moduloId)
      .single();

    res.json({ acesso: !!data });
  } catch (err) {
    console.error('Erro check módulo:', err.message);
    res.status(500).json({ acesso: false });
  }
});

// ─── POST /api/modulos/ativar ─────────────────────────────────────────────────
// Ativa um módulo para a empresa (cria recorrência Cielo separada)
router.post('/ativar', authMiddleware, async (req, res) => {
  try {
    const { modulo_id, cartao, cpf, periodo = 'm' } = req.body;

    const mod = MODULOS[modulo_id];
    if (!mod) return res.status(400).json({ erro: 'Módulo inválido.' });
    if (!cartao?.numero || !cartao?.titular || !cartao?.validade || !cartao?.cvv) {
      return res.status(400).json({ erro: 'Dados do cartão incompletos.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('empresa_id, name, email')
      .eq('id', req.user.id)
      .single();

    if (!user?.empresa_id) {
      return res.status(400).json({ erro: 'Usuário sem empresa associada.' });
    }

    // Verifica se já está ativo
    const { data: existente } = await supabase
      .from('empresa_modulos')
      .select('id')
      .eq('empresa_id', user.empresa_id)
      .eq('modulo_id', modulo_id)
      .single();

    if (existente) return res.status(409).json({ erro: 'Módulo já está ativo.' });

    const valor = periodo === 'a' ? mod.valor_a : mod.valor_m;

    // Cria recorrência Cielo para o módulo
    const resultado = await criarRecorrencia({
      plano:   `modulo_${modulo_id}_${periodo}`,
      cartao,
      cliente: { nome: user.name, email: user.email, cpf },
      userId:  `${user.empresa_id}_${modulo_id}`,
      comPeriodoGratis: false,
      valorOverride: valor,
    });

    const pagamento = resultado.body?.Payment;
    if (!pagamento || pagamento.Status !== 2) {
      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado.';
      return res.status(402).json({ erro: motivo });
    }

    await supabase.from('empresa_modulos').insert({
      empresa_id:          user.empresa_id,
      modulo_id,
      periodo,
      cielo_recurrent_id:  pagamento.RecurrentPayment?.RecurrentPaymentId,
      ativado_por:         req.user.id,
    });

    res.json({ ok: true, modulo_id, ativo: true });
  } catch (err) {
    console.error('Erro ativar módulo:', err.message);
    res.status(500).json({ erro: 'Erro ao ativar módulo.' });
  }
});

// ─── DELETE /api/modulos/:moduloId ───────────────────────────────────────────
// Cancela um módulo (desativa recorrência na Cielo)
router.delete('/:moduloId', authMiddleware, async (req, res) => {
  try {
    const { moduloId } = req.params;

    const { data: user } = await supabase
      .from('users')
      .select('empresa_id')
      .eq('id', req.user.id)
      .single();

    if (!user?.empresa_id) return res.status(400).json({ erro: 'Sem empresa.' });

    const { data: mod } = await supabase
      .from('empresa_modulos')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('modulo_id', moduloId)
      .single();

    if (!mod) return res.status(404).json({ erro: 'Módulo não está ativo.' });

    if (mod.cielo_recurrent_id) {
      await cancelarRecorrencia(mod.cielo_recurrent_id).catch(() => {});
    }

    await supabase
      .from('empresa_modulos')
      .delete()
      .eq('empresa_id', user.empresa_id)
      .eq('modulo_id', moduloId);

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro cancelar módulo:', err.message);
    res.status(500).json({ erro: 'Erro ao cancelar módulo.' });
  }
});

module.exports = router;
