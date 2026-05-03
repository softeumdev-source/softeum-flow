-- Parte C1: tabela de auditoria de expansão dinâmica de schema
-- + função DDL segura (SECURITY DEFINER, whitelist rigorosa)
-- Append-only: sem UPDATE/DELETE policy — apenas service_role insere,
-- apenas super_admin lê.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABELA
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE public.schema_alteracoes_log (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL    DEFAULT now(),
  tipo_operacao           text        NOT NULL
    CONSTRAINT chk_tipo_operacao
      CHECK (tipo_operacao IN ('criar_coluna','mapear_existente','ignorar','falha_ddl')),
  tenant_id_origem        uuid        NULL
    REFERENCES public.tenants (id) ON DELETE SET NULL,
  tabela_alvo             text        NOT NULL
    CONSTRAINT chk_tabela_alvo
      CHECK (tabela_alvo IN ('pedidos','pedido_itens')),
  nome_coluna_origem      text        NOT NULL,
  campo_sistema_resultado text        NULL,
  tipo_dado_proposto      text        NULL
    CONSTRAINT chk_tipo_dado
      CHECK (tipo_dado_proposto IN ('text','numeric','integer','date','timestamptz','boolean')),
  justificativa_ia        text        NULL,
  dados_amostra           jsonb       NULL,
  confianca_ia            numeric(4,3) NULL
    CONSTRAINT chk_confianca
      CHECK (confianca_ia BETWEEN 0 AND 1),
  executado_em            timestamptz NULL,
  executor                text        NULL
    CONSTRAINT chk_executor
      CHECK (executor IN ('system_auto','super_admin','tenant_admin')),
  executor_user_id        uuid        NULL,
  ddl_executado           text        NULL,
  erro_ddl                text        NULL
);

CREATE INDEX idx_sal_tenant   ON public.schema_alteracoes_log (tenant_id_origem);
CREATE INDEX idx_sal_tipo     ON public.schema_alteracoes_log (tipo_operacao);
CREATE INDEX idx_sal_criado   ON public.schema_alteracoes_log (created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. RLS — append-only: service_role insere, super_admin lê, ninguém altera
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.schema_alteracoes_log ENABLE ROW LEVEL SECURITY;

-- Super_admin pode SELECT em todos os registros
CREATE POLICY "super_admin pode ler log de schema"
  ON public.schema_alteracoes_log
  FOR SELECT
  TO authenticated
  USING (public.sou_super_admin());

-- Sem policy INSERT para authenticated: somente service_role
-- (service_role ignora RLS por padrão no Supabase)
-- Sem policy UPDATE nem DELETE: log é imutável após gravação

-- ───────────────────────────────────────────────────────────────────────────
-- 3. FUNÇÃO DDL SEGURA
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.executar_ddl_expansao_pedido(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec           schema_alteracoes_log%ROWTYPE;
  v_ddl           text;
  v_coluna_existe boolean;
BEGIN
  -- (a) Buscar registro
  SELECT * INTO v_rec
  FROM schema_alteracoes_log
  WHERE id = p_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'schema_alteracoes_log: registro % não encontrado', p_log_id;
  END IF;

  -- (b1) tipo_operacao deve ser 'criar_coluna'
  IF v_rec.tipo_operacao <> 'criar_coluna' THEN
    UPDATE schema_alteracoes_log
      SET tipo_operacao = 'falha_ddl',
          erro_ddl      = format('tipo_operacao inválido para execução DDL: %s', v_rec.tipo_operacao),
          executado_em  = now()
      WHERE id = p_log_id;
    RAISE EXCEPTION 'schema_alteracoes_log %: tipo_operacao inválido (esperado criar_coluna, recebido %)',
      p_log_id, v_rec.tipo_operacao;
  END IF;

  -- (b2) Não deve ter sido executado antes
  IF v_rec.executado_em IS NOT NULL THEN
    RAISE EXCEPTION 'schema_alteracoes_log %: operação já foi executada em %',
      p_log_id, v_rec.executado_em;
  END IF;

  -- (b3) tabela_alvo whitelist (redundante com CHECK mas defesa em profundidade)
  IF v_rec.tabela_alvo NOT IN ('pedidos', 'pedido_itens') THEN
    UPDATE schema_alteracoes_log
      SET tipo_operacao = 'falha_ddl',
          erro_ddl      = format('tabela_alvo fora da whitelist: %s', v_rec.tabela_alvo),
          executado_em  = now()
      WHERE id = p_log_id;
    RAISE EXCEPTION 'schema_alteracoes_log %: tabela_alvo fora da whitelist: %',
      p_log_id, v_rec.tabela_alvo;
  END IF;

  -- (b4) tipo_dado_proposto whitelist
  IF v_rec.tipo_dado_proposto NOT IN ('text','numeric','integer','date','timestamptz','boolean') THEN
    UPDATE schema_alteracoes_log
      SET tipo_operacao = 'falha_ddl',
          erro_ddl      = format('tipo_dado_proposto fora da whitelist: %s', v_rec.tipo_dado_proposto),
          executado_em  = now()
      WHERE id = p_log_id;
    RAISE EXCEPTION 'schema_alteracoes_log %: tipo_dado_proposto fora da whitelist: %',
      p_log_id, v_rec.tipo_dado_proposto;
  END IF;

  -- (b5) campo_sistema_resultado: snake_case válido, primeiro char letra,
  --      apenas [a-z0-9_], 1–63 chars
  IF v_rec.campo_sistema_resultado IS NULL
    OR v_rec.campo_sistema_resultado !~ '^[a-z][a-z0-9_]{0,62}$'
  THEN
    UPDATE schema_alteracoes_log
      SET tipo_operacao = 'falha_ddl',
          erro_ddl      = format('campo_sistema_resultado inválido: %s', v_rec.campo_sistema_resultado),
          executado_em  = now()
      WHERE id = p_log_id;
    RAISE EXCEPTION 'schema_alteracoes_log %: campo_sistema_resultado inválido: %',
      p_log_id, v_rec.campo_sistema_resultado;
  END IF;

  -- (b6) Coluna não deve existir já na tabela alvo
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = v_rec.tabela_alvo
      AND column_name  = v_rec.campo_sistema_resultado
  ) INTO v_coluna_existe;

  IF v_coluna_existe THEN
    UPDATE schema_alteracoes_log
      SET tipo_operacao = 'falha_ddl',
          erro_ddl      = format('coluna %I já existe em %I', v_rec.campo_sistema_resultado, v_rec.tabela_alvo),
          executado_em  = now()
      WHERE id = p_log_id;
    RAISE EXCEPTION 'schema_alteracoes_log %: coluna % já existe em %',
      p_log_id, v_rec.campo_sistema_resultado, v_rec.tabela_alvo;
  END IF;

  -- (d) Executar DDL — format com %I garante escape de identifiers
  v_ddl := format(
    'ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I %s',
    v_rec.tabela_alvo,
    v_rec.campo_sistema_resultado,
    v_rec.tipo_dado_proposto  -- vem de whitelist, seguro usar diretamente
  );

  EXECUTE v_ddl;

  -- (e) Registrar sucesso
  UPDATE schema_alteracoes_log
    SET executado_em  = now(),
        ddl_executado = v_ddl
    WHERE id = p_log_id;

  -- (f) Retornar resultado
  RETURN jsonb_build_object(
    'ok',      true,
    'tabela',  v_rec.tabela_alvo,
    'coluna',  v_rec.campo_sistema_resultado,
    'tipo',    v_rec.tipo_dado_proposto,
    'ddl',     v_ddl
  );

EXCEPTION WHEN OTHERS THEN
  -- Captura erros inesperados do Postgres durante ALTER ou outra operação
  -- (b1-b6 já fazem UPDATE antes de RAISE, então só chegam aqui erros não antecipados)
  UPDATE schema_alteracoes_log
    SET tipo_operacao = 'falha_ddl',
        erro_ddl      = SQLERRM,
        executado_em  = now()
    WHERE id = p_log_id
      AND executado_em IS NULL;  -- evita sobrescrever falha já registrada por b1-b6
  RAISE;
END;
$$;

-- Revogar de PUBLIC e conceder apenas ao service_role
REVOKE EXECUTE ON FUNCTION public.executar_ddl_expansao_pedido(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.executar_ddl_expansao_pedido(uuid) TO service_role;
