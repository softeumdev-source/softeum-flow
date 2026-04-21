export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      configuracoes: {
        Row: {
          chave: string
          created_at: string | null
          descricao: string | null
          id: string
          tenant_id: string | null
          updated_at: string | null
          valor: string | null
        }
        Insert: {
          chave: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          tenant_id?: string | null
          updated_at?: string | null
          valor?: string | null
        }
        Update: {
          chave?: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          tenant_id?: string | null
          updated_at?: string | null
          valor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_itens: {
        Row: {
          aceito: boolean | null
          created_at: string | null
          id: string
          pedido_id: string
          preco_unitario: number | null
          produto_codigo: string | null
          produto_descricao: string | null
          quantidade: number | null
          sugestao_erp: string | null
          tenant_id: string
          total: number | null
          unidade: string | null
        }
        Insert: {
          aceito?: boolean | null
          created_at?: string | null
          id?: string
          pedido_id: string
          preco_unitario?: number | null
          produto_codigo?: string | null
          produto_descricao?: string | null
          quantidade?: number | null
          sugestao_erp?: string | null
          tenant_id: string
          total?: number | null
          unidade?: string | null
        }
        Update: {
          aceito?: boolean | null
          created_at?: string | null
          id?: string
          pedido_id?: string
          preco_unitario?: number | null
          produto_codigo?: string | null
          produto_descricao?: string | null
          quantidade?: number | null
          sugestao_erp?: string | null
          tenant_id?: string
          total?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_logs: {
        Row: {
          alterado_por: string | null
          campo: string
          created_at: string | null
          id: string
          pedido_id: string
          tenant_id: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          alterado_por?: string | null
          campo: string
          created_at?: string | null
          id?: string
          pedido_id: string
          tenant_id: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          alterado_por?: string | null
          campo?: string
          created_at?: string | null
          id?: string
          pedido_id?: string
          tenant_id?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_logs_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          atualizado_por: string | null
          confianca_ia: number | null
          created_at: string | null
          criado_por: string | null
          data_entrega: string | null
          data_pedido: string | null
          data_recebimento_email: string | null
          email_remetente: string | null
          empresa: string | null
          exportacao_erro: string | null
          exportacao_metodo: string | null
          exportacao_tentativas: number
          exportado: boolean
          exportado_em: string | null
          id: string
          numero: string
          observacoes: string | null
          pdf_url: string | null
          status: string | null
          tenant_id: string
          total_previsto: number | null
          updated_at: string | null
        }
        Insert: {
          atualizado_por?: string | null
          confianca_ia?: number | null
          created_at?: string | null
          criado_por?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_recebimento_email?: string | null
          email_remetente?: string | null
          empresa?: string | null
          exportacao_erro?: string | null
          exportacao_metodo?: string | null
          exportacao_tentativas?: number
          exportado?: boolean
          exportado_em?: string | null
          id?: string
          numero: string
          observacoes?: string | null
          pdf_url?: string | null
          status?: string | null
          tenant_id: string
          total_previsto?: number | null
          updated_at?: string | null
        }
        Update: {
          atualizado_por?: string | null
          confianca_ia?: number | null
          created_at?: string | null
          criado_por?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_recebimento_email?: string | null
          email_remetente?: string | null
          empresa?: string | null
          exportacao_erro?: string | null
          exportacao_metodo?: string | null
          exportacao_tentativas?: number
          exportado?: boolean
          exportado_em?: string | null
          id?: string
          numero?: string
          observacoes?: string | null
          pdf_url?: string | null
          status?: string | null
          tenant_id?: string
          total_previsto?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      planos: {
        Row: {
          created_at: string | null
          id: string
          limite_pedidos_mes: number
          nome: string
          preco_mensal: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          limite_pedidos_mes: number
          nome: string
          preco_mensal?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          limite_pedidos_mes?: number
          nome?: string
          preco_mensal?: number | null
        }
        Relationships: []
      }
      super_admins: {
        Row: {
          created_at: string | null
          id: string
          nome: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tenant_erp_config: {
        Row: {
          api_key: string | null
          ativo: boolean | null
          created_at: string | null
          endpoint: string | null
          id: string
          layout_arquivo: string | null
          layout_filename: string | null
          layout_mime: string | null
          mapeamento_campos: Json | null
          tenant_id: string
          tipo: string | null
          tipo_erp: string | null
          updated_at: string | null
        }
        Insert: {
          api_key?: string | null
          ativo?: boolean | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          layout_arquivo?: string | null
          layout_filename?: string | null
          layout_mime?: string | null
          mapeamento_campos?: Json | null
          tenant_id: string
          tipo?: string | null
          tipo_erp?: string | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string | null
          ativo?: boolean | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          layout_arquivo?: string | null
          layout_filename?: string | null
          layout_mime?: string | null
          mapeamento_campos?: Json | null
          tenant_id?: string
          tipo?: string | null
          tipo_erp?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_erp_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_gmail_config: {
        Row: {
          access_token: string | null
          assunto_filtro: string | null
          ativo: boolean | null
          created_at: string | null
          email: string
          id: string
          refresh_token: string | null
          tenant_id: string
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          assunto_filtro?: string | null
          ativo?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          refresh_token?: string | null
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          assunto_filtro?: string | null
          ativo?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          refresh_token?: string | null
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_gmail_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_membros: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          nome: string | null
          papel: Database["public"]["Enums"]["app_role"]
          session_token: string | null
          tenant_id: string
          ultimo_acesso: string | null
          user_id: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome?: string | null
          papel?: Database["public"]["Enums"]["app_role"]
          session_token?: string | null
          tenant_id: string
          ultimo_acesso?: string | null
          user_id: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome?: string | null
          papel?: Database["public"]["Enums"]["app_role"]
          session_token?: string | null
          tenant_id?: string
          ultimo_acesso?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_membros_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_uso: {
        Row: {
          ano_mes: string
          created_at: string | null
          erros_ia: number | null
          id: string
          pedidos_processados: number | null
          tenant_id: string
          total_previsto_processado: number | null
          updated_at: string | null
        }
        Insert: {
          ano_mes: string
          created_at?: string | null
          erros_ia?: number | null
          id?: string
          pedidos_processados?: number | null
          tenant_id: string
          total_previsto_processado?: number | null
          updated_at?: string | null
        }
        Update: {
          ano_mes?: string
          created_at?: string | null
          erros_ia?: number | null
          id?: string
          pedidos_processados?: number | null
          tenant_id?: string
          total_previsto_processado?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_uso_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ativo: boolean | null
          bairro: string | null
          bloqueado_em: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          comentarios: string | null
          complemento: string | null
          created_at: string | null
          data_inicio_contrato: string | null
          data_inicio_pagamento: string | null
          data_vencimento_contrato: string | null
          dia_vencimento: number | null
          email_financeiro: string | null
          endereco: string | null
          estado: string | null
          executivo_venda: string | null
          forma_pagamento: string | null
          gestor_contrato: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          limite_pedidos_mes: number | null
          limite_usuarios: number | null
          motivo_bloqueio: string | null
          nome: string
          nome_fantasia: string | null
          notas: string | null
          numero_endereco: string | null
          plano_id: string | null
          responsavel_financeiro: string | null
          slug: string
          telefone: string | null
          tipo_integracao: string | null
          updated_at: string | null
          valor_excedente: number | null
          valor_mensal: number | null
          valor_setup: number | null
        }
        Insert: {
          ativo?: boolean | null
          bairro?: string | null
          bloqueado_em?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          comentarios?: string | null
          complemento?: string | null
          created_at?: string | null
          data_inicio_contrato?: string | null
          data_inicio_pagamento?: string | null
          data_vencimento_contrato?: string | null
          dia_vencimento?: number | null
          email_financeiro?: string | null
          endereco?: string | null
          estado?: string | null
          executivo_venda?: string | null
          forma_pagamento?: string | null
          gestor_contrato?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          limite_pedidos_mes?: number | null
          limite_usuarios?: number | null
          motivo_bloqueio?: string | null
          nome: string
          nome_fantasia?: string | null
          notas?: string | null
          numero_endereco?: string | null
          plano_id?: string | null
          responsavel_financeiro?: string | null
          slug: string
          telefone?: string | null
          tipo_integracao?: string | null
          updated_at?: string | null
          valor_excedente?: number | null
          valor_mensal?: number | null
          valor_setup?: number | null
        }
        Update: {
          ativo?: boolean | null
          bairro?: string | null
          bloqueado_em?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          comentarios?: string | null
          complemento?: string | null
          created_at?: string | null
          data_inicio_contrato?: string | null
          data_inicio_pagamento?: string | null
          data_vencimento_contrato?: string | null
          dia_vencimento?: number | null
          email_financeiro?: string | null
          endereco?: string | null
          estado?: string | null
          executivo_venda?: string | null
          forma_pagamento?: string | null
          gestor_contrato?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          limite_pedidos_mes?: number | null
          limite_usuarios?: number | null
          motivo_bloqueio?: string | null
          nome?: string
          nome_fantasia?: string | null
          notas?: string | null
          numero_endereco?: string | null
          plano_id?: string | null
          responsavel_financeiro?: string | null
          slug?: string
          telefone?: string | null
          tipo_integracao?: string | null
          updated_at?: string | null
          valor_excedente?: number | null
          valor_mensal?: number | null
          valor_setup?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_tenant_member: {
        Args: {
          p_nome: string
          p_papel: Database["public"]["Enums"]["app_role"]
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      criar_tenant_completo: {
        Args: { p_admin_nome: string; p_admin_user_id: string; p_dados: Json }
        Returns: string
      }
      criar_uso_mes_atual: { Args: never; Returns: undefined }
      get_user_tenant_id: { Args: never; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "operador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operador"],
    },
  },
} as const
